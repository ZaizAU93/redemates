package com.example.RideMate.service;

import com.example.RideMate.dto.MatchDTO;
import com.example.RideMate.dto.MatchResponseDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.UserRepository;
import lombok.Data;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;


@Service
public class MatchService {

    private final MatchRepository matchRepository;
    private final RideRequestRepository rideRequestRepository;
    private final UserRepository userRepository;
    private final TelegramBotService telegramBotService;
    private final SafetyService safetyService;

    public MatchService(MatchRepository matchRepository,
                        RideRequestRepository rideRequestRepository,
                        UserRepository userRepository,
                        TelegramBotService telegramBotService,
                        SafetyService safetyService) {
        this.matchRepository = matchRepository;
        this.rideRequestRepository = rideRequestRepository;
        this.userRepository = userRepository;
        this.telegramBotService = telegramBotService;
        this.safetyService = safetyService;
    }

    @Transactional
    public MatchResponseDTO respondToRideRequest(Long rideRequestId, Long responderTelegramId) {
        User responder = userRepository.findByTelegramId(responderTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        Long ownerTelegramId = rideRequest.getUser().getTelegramId();

        // Проверка блокировки
        if (safetyService.isBlocked(responderTelegramId, ownerTelegramId) ||
                safetyService.isBlocked(ownerTelegramId, responderTelegramId)) {
            throw new RuntimeException("Невозможно откликнуться: пользователь заблокирован");
        }

        if (matchRepository.existsByRideRequestIdAndResponderId(rideRequestId, responder.getId())) {
            throw new RuntimeException("Вы уже откликнулись на эту заявку");
        }

        Match match = new Match();
        match.setRideRequest(rideRequest);
        match.setResponder(responder);
        match = matchRepository.save(match);

        User owner = rideRequest.getUser();
        if (owner.getChatId() != null) {
            String message = String.format(
                    "🔔 Новый отклик от %s %s на вашу заявку",
                    responder.getFirstName(),
                    responder.getLastName() != null ? responder.getLastName() : ""
            );
            telegramBotService.sendMessage(owner.getChatId(), message);
        }

        return new MatchResponseDTO(match.getId(), rideRequestId, "Отклик отправлен");
    }

    public List<MatchDTO> getMyResponses(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return matchRepository.findByResponderId(user.getId())
                .stream()
                .map(match -> toMatchDTO(match, false))
                .toList();
    }

    public List<MatchDTO> getResponsesForRequest(Long rideRequestId, Long ownerTelegramId) {
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));
        if (!rideRequest.getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }
        return matchRepository.findByRideRequestId(rideRequestId)
                .stream()
                .map(match -> toMatchDTO(match, true))
                .toList();
    }

    @Transactional
    public void acceptResponse(Long matchId, Long ownerTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Отклик не найден"));
        RideRequest rideRequest = match.getRideRequest();
        if (!rideRequest.getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }

        // Атомарно списываем 1 место (для MVP)
        if (rideRequest.getRole() == Role.DRIVER) {
            int updated = rideRequestRepository.decrementSeats(rideRequest.getId(), 1);
            if (updated == 0) {
                throw new RuntimeException("Свободных мест больше нет");
            }
        }

        match.setStatus(MatchStatus.ACCEPTED);
        matchRepository.save(match);

        rideRequest.setStatus(RideStatus.MATCHED);
        rideRequest.setAcceptedMatchId(match.getId());
        rideRequestRepository.save(rideRequest);

        // Отклоняем остальные PENDING
        List<Match> pending = matchRepository.findByRideRequestIdAndStatus(
                rideRequest.getId(), MatchStatus.PENDING);
        for (Match m : pending) {
            if (!m.getId().equals(match.getId())) {
                m.setStatus(MatchStatus.REJECTED);
                matchRepository.save(m);
                User responder = m.getResponder();
                if (responder.getChatId() != null) {
                    telegramBotService.sendMessage(responder.getChatId(),
                            "❌ Ваш отклик был отклонён: владелец выбрал другого попутчика.");
                }
            }
        }

        // Уведомляем принятого
        User responder = match.getResponder();
        if (responder.getChatId() != null) {
            telegramBotService.sendMessage(responder.getChatId(),
                    "✅ Ваш отклик принят! Свяжитесь с владельцем: @" + rideRequest.getUser().getUsername());
        }
    }

    @Transactional
    public void rejectResponse(Long matchId, Long ownerTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Отклик не найден"));
        if (!match.getRideRequest().getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }
        match.setStatus(MatchStatus.REJECTED);
        matchRepository.save(match);

        User responder = match.getResponder();
        if (responder.getChatId() != null) {
            telegramBotService.sendMessage(responder.getChatId(),
                    "❌ Ваш отклик был отклонён.");
        }
    }

    @Transactional
    public void cancelMatch(Long matchId, Long requesterTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Отклик не найден"));
        RideRequest rideRequest = match.getRideRequest();
        Long ownerTelegramId = rideRequest.getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();

        boolean isOwner = requesterTelegramId.equals(ownerTelegramId);
        boolean isResponder = requesterTelegramId.equals(responderTelegramId);
        if (!isOwner && !isResponder) {
            throw new RuntimeException("Вы не участник этого матча");
        }

        match.setStatus(MatchStatus.REJECTED);
        matchRepository.save(match);
        rideRequest.setStatus(RideStatus.ACTIVE);
        rideRequest.setAcceptedMatchId(null);
        rideRequestRepository.save(rideRequest);

        // Возвращаем место, если водитель
        if (rideRequest.getRole() == Role.DRIVER) {
            rideRequestRepository.incrementSeats(rideRequest.getId());
        }

        Long otherTelegramId = isOwner ? responderTelegramId : ownerTelegramId;
        User otherUser = userRepository.findByTelegramId(otherTelegramId).orElse(null);
        if (otherUser != null && otherUser.getChatId() != null) {
            telegramBotService.sendMessage(otherUser.getChatId(),
                    "❌ Матч был отменён. Заявка снова активна.");
        }
    }

    private MatchDTO toMatchDTO(Match match, boolean forOwner) {
        String contactUsername;
        Long responderTelegramId = match.getResponder().getTelegramId();
        if (forOwner) {
            User responder = match.getResponder();
            contactUsername = (responder.getUsername() != null && !responder.getUsername().isEmpty())
                    ? responder.getUsername()
                    : String.valueOf(responder.getTelegramId());
        } else {
            User owner = match.getRideRequest().getUser();
            contactUsername = (owner.getUsername() != null && !owner.getUsername().isEmpty())
                    ? owner.getUsername()
                    : String.valueOf(owner.getTelegramId());
        }
        return new MatchDTO(
                match.getId(),
                match.getRideRequest().getId(),
                match.getResponder().getFirstName() + " " +
                        (match.getResponder().getLastName() != null ? match.getResponder().getLastName() : ""),
                match.getStatus().name(),
                match.getCreatedAt(),
                contactUsername,
                responderTelegramId
        );
    }
}