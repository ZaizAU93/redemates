package com.example.RideMate.service;

import com.example.RideMate.dto.MatchDTO;
import com.example.RideMate.dto.MatchResponseDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.UserRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class MatchService {

    private static final int CONFIRM_DEADLINE_HOURS = 12;

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

    // ---------- Запрос брони ----------

    @Transactional
    public MatchResponseDTO respondToRideRequest(Long rideRequestId, Long responderTelegramId, Integer seatsRequested) {
        User responder = userRepository.findByTelegramId(responderTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        if (rideRequest.getUser().getTelegramId().equals(responderTelegramId)) {
            throw new RuntimeException("Нельзя бронировать свою заявку");
        }
        if (rideRequest.getStatus() != RideStatus.ACTIVE) {
            throw new RuntimeException("Заявка уже не активна");
        }

        Long ownerTelegramId = rideRequest.getUser().getTelegramId();
        if (safetyService.isBlocked(responderTelegramId, ownerTelegramId) ||
                safetyService.isBlocked(ownerTelegramId, responderTelegramId)) {
            throw new RuntimeException("Невозможно откликнуться: пользователь заблокирован");
        }

        if (matchRepository.existsByRideRequestIdAndResponderId(rideRequestId, responder.getId())) {
            throw new RuntimeException("Вы уже откликнулись на эту заявку");
        }

        int seats = resolveSeats(rideRequest, seatsRequested);
        if (rideRequest.getRole() == Role.DRIVER) {
            Integer available = rideRequest.getAvailableSeats();
            if (available == null || seats < 1 || seats > available) {
                throw new RuntimeException("Недостаточно свободных мест");
            }
        }

        Match match = new Match();
        match.setRideRequest(rideRequest);
        match.setResponder(responder);
        match.setSeats(seats);
        match = matchRepository.save(match);

        User owner = rideRequest.getUser();
        if (owner.getChatId() != null) {
            String message = String.format(
                    "🔔 Новый запрос брони от %s %s: %d мест. Заявка #%d",
                    responder.getFirstName(),
                    responder.getLastName() != null ? responder.getLastName() : "",
                    seats, rideRequestId
            );
            telegramBotService.sendMessage(owner.getChatId(), message);
        }

        return new MatchResponseDTO(match.getId(), rideRequestId, "Запрос брони отправлен");
    }

    private int resolveSeats(RideRequest ride, Integer requested) {
        if (ride.getRole() == Role.PASSENGER) {
            return ride.getPassengerCount() != null ? ride.getPassengerCount() : 1;
        }
        return requested != null && requested >= 1 ? requested : 1;
    }

    // ---------- Принятие: списание мест + дедлайн ----------

    @Transactional
    public void acceptResponse(Long matchId, Long ownerTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Бронь не найдена"));
        RideRequest rideRequest = match.getRideRequest();
        if (!rideRequest.getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }
        if (match.getStatus() != MatchStatus.PENDING) {
            throw new RuntimeException("Бронь уже обработана");
        }

        if (rideRequest.getRole() == Role.DRIVER) {
            int updated = rideRequestRepository.decrementSeats(rideRequest.getId(), match.getSeats());
            if (updated == 0) {
                throw new RuntimeException("Свободных мест больше нет");
            }
        }

        match.setStatus(MatchStatus.CONFIRMING);
        match.setExpiresAt(LocalDateTime.now().plusHours(CONFIRM_DEADLINE_HOURS));
        matchRepository.save(match);

        rideRequest.setStatus(RideStatus.MATCHED);
        rideRequest.setAcceptedMatchId(match.getId());
        rideRequestRepository.save(rideRequest);

        Integer available = rideRequest.getAvailableSeats();
        boolean noSeatsLeft = rideRequest.getRole() == Role.DRIVER && (available == null || available <= 0);
        if (noSeatsLeft) {
            List<Match> pending = matchRepository.findByRideRequestIdAndStatus(rideRequest.getId(), MatchStatus.PENDING);
            for (Match m : pending) {
                if (!m.getId().equals(match.getId())) {
                    m.setStatus(MatchStatus.REJECTED);
                    matchRepository.save(m);
                    notify(m.getResponder(), "❌ Ваш запрос брони отклонён: места разобрали.");
                }
            }
        }

        notify(match.getResponder(),
                "✅ Водитель принял ваш запрос! Подтвердите бронь в приложении в течение " +
                        CONFIRM_DEADLINE_HOURS + " часов, иначе место вернётся в пул.");
        notify(rideRequest.getUser(),
                "Ждём подтверждения брони от второй стороны в течение " + CONFIRM_DEADLINE_HOURS + " часов.");
    }

    // ---------- Подтверждение второй стороной ----------

    @Transactional
    public void confirmResponse(Long matchId, Long telegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Бронь не найдена"));
        RideRequest rideRequest = match.getRideRequest();

        boolean isOwner = rideRequest.getUser().getTelegramId().equals(telegramId);
        boolean isResponder = match.getResponder().getTelegramId().equals(telegramId);
        if (!isOwner && !isResponder) {
            throw new RuntimeException("Вы не участник этой брони");
        }
        if (match.getStatus() != MatchStatus.CONFIRMING) {
            throw new RuntimeException("Бронь не ожидает подтверждения");
        }

        match.setStatus(MatchStatus.CONFIRMED);
        match.setConfirmedAt(LocalDateTime.now());
        match.setExpiresAt(null);
        matchRepository.save(match);

        User owner = rideRequest.getUser();
        User responder = match.getResponder();
        notify(owner, "✅ Бронь подтверждена! Контакты собеседника: @" + responder.getUsername());
        notify(responder, "✅ Бронь подтверждена! Контакты собеседника: @" + owner.getUsername());
    }

    // ---------- Отклонение ----------

    @Transactional
    public void rejectResponse(Long matchId, Long ownerTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Бронь не найдена"));
        if (!match.getRideRequest().getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }
        if (match.getStatus() == MatchStatus.CONFIRMING || match.getStatus() == MatchStatus.CONFIRMED) {
            throw new RuntimeException("Сначала отмените бронь — места уже заняты");
        }
        match.setStatus(MatchStatus.REJECTED);
        matchRepository.save(match);
        notify(match.getResponder(), "❌ Ваш запрос брони был отклонён.");
    }

    // ---------- Отмена (любой участник) ----------

    @Transactional
    public void cancelMatch(Long matchId, Long requesterTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Бронь не найдена"));
        RideRequest rideRequest = match.getRideRequest();
        Long ownerTelegramId = rideRequest.getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();

        if (!requesterTelegramId.equals(ownerTelegramId) && !requesterTelegramId.equals(responderTelegramId)) {
            throw new RuntimeException("Вы не участник этой брони");
        }
        if (match.getStatus() == MatchStatus.REJECTED || match.getStatus() == MatchStatus.COMPLETED) {
            throw new RuntimeException("Бронь уже закрыта");
        }

        boolean wasHoldingSeats = match.getStatus() == MatchStatus.CONFIRMING || match.getStatus() == MatchStatus.CONFIRMED;

        match.setStatus(MatchStatus.REJECTED);
        match.setExpiresAt(null);
        matchRepository.save(match);

        if (wasHoldingSeats && rideRequest.getRole() == Role.DRIVER) {
            rideRequestRepository.incrementSeats(rideRequest.getId(), match.getSeats());
        }
        rideRequest.setStatus(RideStatus.ACTIVE);
        rideRequest.setAcceptedMatchId(null);
        rideRequestRepository.save(rideRequest);

        Long otherTelegramId = requesterTelegramId.equals(ownerTelegramId) ? responderTelegramId : ownerTelegramId;
        User otherUser = userRepository.findByTelegramId(otherTelegramId).orElse(null);
        if (otherUser != null) {
            notify(otherUser, "❌ Бронь отменена. Места вернулись в пул, заявка снова активна.");
        }
    }

    // ---------- Дедлайн подтверждения ----------

    @Scheduled(fixedRate = 60_000)
    @Transactional
    public void expireUnconfirmedBookings() {
        List<Match> expired = matchRepository.findByStatusAndExpiresAtBefore(
                MatchStatus.CONFIRMING, LocalDateTime.now());
        for (Match match : expired) {
            RideRequest rideRequest = match.getRideRequest();
            match.setStatus(MatchStatus.REJECTED);
            match.setExpiresAt(null);
            matchRepository.save(match);

            if (rideRequest.getRole() == Role.DRIVER) {
                rideRequestRepository.incrementSeats(rideRequest.getId(), match.getSeats());
            }
            if (match.getId().equals(rideRequest.getAcceptedMatchId())) {
                rideRequest.setAcceptedMatchId(null);
                rideRequest.setStatus(RideStatus.ACTIVE);
                rideRequestRepository.save(rideRequest);
            }

            notify(rideRequest.getUser(), "⏰ Бронь не подтверждена вовремя — места вернулись в пул.");
            notify(match.getResponder(), "⏰ Вы не подтвердили бронь вовремя — она отменена.");
        }
    }

    // ---------- Уведомления об откликах ----------

    /**
     * Id заявок, на которые пользователь уже откликнулся (и отклик ещё жив).
     * Фронт по нему гасит кнопку «Откликнуться» на этих карточках.
     */
    @Transactional(readOnly = true)
    public List<Long> getMyRespondedRideRequestIds(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return matchRepository.findByResponderId(user.getId()).stream()
                .filter(m -> m.getStatus() == MatchStatus.PENDING
                        || m.getStatus() == MatchStatus.CONFIRMING
                        || m.getStatus() == MatchStatus.CONFIRMED)
                .map(m -> m.getRideRequest().getId())
                .distinct()
                .toList();
    }

    /**
     * Сколько живых откликов (PENDING) сейчас на заявки пользователя.
     * Фронт по изменению этого числа показывает «🔔 Новый отклик».
     */
    @Transactional(readOnly = true)
    public long getOwnerPendingResponseCount(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return matchRepository.findByRideRequestUserId(user.getId()).stream()
                .filter(m -> m.getStatus() == MatchStatus.PENDING)
                .count();
    }

    // ---------- Вспомогательное ----------

    private void notify(User user, String text) {
        if (user != null && user.getChatId() != null) {
            telegramBotService.sendMessage(user.getChatId(), text);
        }
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

    /**
     * Сколько броней сейчас в статусе CONFIRMING, где пользователь — участник
     * (откликнулся или владелец заявки). Фронт по увеличению показывает
     * «Вашу бронь приняли — подтвердите».
     */
    @Transactional(readOnly = true)
    public long getConfirmingBookingCount(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        long asResponder = matchRepository.findByResponderId(user.getId()).stream()
                .filter(m -> m.getStatus() == MatchStatus.CONFIRMING)
                .count();
        long asOwner = matchRepository.findByRideRequestUserId(user.getId()).stream()
                .filter(m -> m.getStatus() == MatchStatus.CONFIRMING)
                .count();
        return asResponder + asOwner;
    }

}
