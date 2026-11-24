package com.example.RideMate.service;

import com.example.RideMate.dto.MatchDTO;
import com.example.RideMate.dto.MatchResponseDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.ReviewRepository;
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

    private final ReviewRepository reviewRepository;

    public MatchService(MatchRepository matchRepository,
                        RideRequestRepository rideRequestRepository,
                        UserRepository userRepository,
                        TelegramBotService telegramBotService,
                        SafetyService safetyService,
                        ReviewRepository reviewRepository) {
        this.matchRepository = matchRepository;
        this.rideRequestRepository = rideRequestRepository;
        this.userRepository = userRepository;
        this.telegramBotService = telegramBotService;
        this.safetyService = safetyService;
        this.reviewRepository = reviewRepository;
    }

    // ---------- Запрос брони ----------

    @Transactional
    public MatchResponseDTO respondToRideRequest(Long rideRequestId, Long responderTelegramId, Integer seatsRequested) {
        User responder = userRepository.findByTelegramId(responderTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        if (responder.getStatus() == UserStatus.BANNED) {
            throw new RuntimeException("Аккаунт заблокирован");
        }


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

    // ---------- Исход поездки: отчёты сторон, no-show, споры ----------

    @Transactional
    public MatchStatus reportOutcome(Long matchId, Long telegramId, OutcomeReport outcome) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Бронь не найдена"));
        RideRequest ride = match.getRideRequest();

        boolean isOwner = ride.getUser().getTelegramId().equals(telegramId);
        boolean isResponder = match.getResponder().getTelegramId().equals(telegramId);
        if (!isOwner && !isResponder) {
            throw new RuntimeException("Вы не участник этой брони");
        }
        if (match.getStatus() != MatchStatus.CONFIRMED) {
            throw new RuntimeException("Отчитываться можно только по подтверждённой брони");
        }
        if (ride.getDepartureTime() != null && ride.getDepartureTime().isAfter(LocalDateTime.now())) {
            throw new RuntimeException("Отчитаться можно после времени выезда");
        }

        boolean iAmDriver = (ride.getRole() == Role.DRIVER) == isOwner;
        if (iAmDriver) match.setDriverOutcome(outcome);
        else match.setPassengerOutcome(outcome);
        matchRepository.save(match);

        // Ждём отчёт второй стороны — уведомляем именно её
        if (match.getDriverOutcome() == null || match.getPassengerOutcome() == null) {
            User otherUser = isOwner ? match.getResponder() : ride.getUser();
            notify(otherUser, "⏱ Вторая сторона отчиталась о поездке. Подтвердите исход в приложении: «Заявки».");
            return match.getStatus();
        }

        // Оба отчёта получены — сравниваем и закрываем
        User owner = ride.getUser();
        User responder = match.getResponder();
        boolean ownerIsDriver = ride.getRole() == Role.DRIVER;
        User driver = ownerIsDriver ? owner : responder;
        User passenger = ownerIsDriver ? responder : owner;

        if (match.getDriverOutcome() == match.getPassengerOutcome()) {
            if (match.getDriverOutcome() == OutcomeReport.COMPLETED) {
                match.setStatus(MatchStatus.COMPLETED);
                driver.setTripCount((driver.getTripCount() != null ? driver.getTripCount() : 0) + 1);
                passenger.setTripCount((passenger.getTripCount() != null ? passenger.getTripCount() : 0) + 1);
                userRepository.save(driver);
                userRepository.save(passenger);
                ride.setStatus(RideStatus.COMPLETED);
                rideRequestRepository.save(ride);
                notify(owner, "🎉 Поездка состоялась! Не забудьте оставить отзыв.");
                notify(responder, "🎉 Поездка состоялась! Не забудьте оставить отзыв.");
            } else {
                User guilty = match.getDriverOutcome() == OutcomeReport.NO_SHOW_PASSENGER ? passenger : driver;
                guilty.setNoShowCount((guilty.getNoShowCount() != null ? guilty.getNoShowCount() : 0) + 1);
                userRepository.save(guilty);
                match.setStatus(match.getDriverOutcome() == OutcomeReport.NO_SHOW_PASSENGER
                        ? MatchStatus.NO_SHOW_PASSENGER
                        : MatchStatus.NO_SHOW_DRIVER);
                releaseSeatsAndRide(match);
                notify(owner, "⚠️ Поездка зафиксирована как несостоявшаяся. Места вернулись в пул.");
                notify(responder, "⚠️ Поездка зафиксирована как несостоявшаяся. Места вернулись в пул.");
            }
        } else {
            match.setStatus(MatchStatus.DISPUTED);
            notify(owner, "⚖️ Показания о поездке разошлись — вопрос передан на модерацию.");
            notify(responder, "⚖️ Показания о поездке разошлись — вопрос передан на модерацию.");
        }
        matchRepository.save(match);
        return match.getStatus();
    }

    /** Виноватый объявлен: места возвращаются в пул, заявка снова активна. */
    private void releaseSeatsAndRide(Match match) {
        RideRequest ride = match.getRideRequest();
        if (ride.getRole() == Role.DRIVER) {
            rideRequestRepository.incrementSeats(ride.getId(), match.getSeats());
        }
        if (match.getId().equals(ride.getAcceptedMatchId())) {
            ride.setAcceptedMatchId(null);
            ride.setStatus(RideStatus.ACTIVE);
            rideRequestRepository.save(ride);
        }
    }


    /** Решение модератора по спорному матчу: DRIVER = прав водитель, PASSENGER = прав пассажир, VOID = без штрафа. */
    @Transactional
    public void resolveDispute(Long matchId, String decision) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Матч не найден"));
        if (match.getStatus() != MatchStatus.DISPUTED) {
            throw new RuntimeException("Этот матч не в статусе спора");
        }
        RideRequest ride = match.getRideRequest();
        User owner = ride.getUser();
        User responder = match.getResponder();
        boolean ownerIsDriver = ride.getRole() == Role.DRIVER;
        User driver = ownerIsDriver ? owner : responder;
        User passenger = ownerIsDriver ? responder : owner;

        switch (decision) {
            case "DRIVER" -> {
                passenger.setNoShowCount((passenger.getNoShowCount() != null ? passenger.getNoShowCount() : 0) + 1);
                userRepository.save(passenger);
                match.setStatus(MatchStatus.NO_SHOW_PASSENGER);
            }
            case "PASSENGER" -> {
                driver.setNoShowCount((driver.getNoShowCount() != null ? driver.getNoShowCount() : 0) + 1);
                userRepository.save(driver);
                match.setStatus(MatchStatus.NO_SHOW_DRIVER);
            }
            default -> match.setStatus(MatchStatus.REJECTED);
        }
        releaseSeatsAndRide(match);
        matchRepository.save(match);
        notify(owner, "⚖️ Модератор разобрал спор по вашей поездке. Итог: " + match.getStatus().name());
        notify(responder, "⚖️ Модератор разобрал спор по вашей поездке. Итог: " + match.getStatus().name());
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

    // ---------- Авто-финализация исходов ----------

    /** Одна сторона отчиталась, вторая молчит 24 часа после выезда — закрываем по отчёту первой.
     *  Для теста: fixedRate = 60_000 и дедлайн minusMinutes(2). */
    @Scheduled(fixedRate = 3600_000)
    @Transactional
    public void finalizeStaleOutcomes() {
        List<Match> stale = matchRepository.findStaleOutcomes(LocalDateTime.now().minusHours(24));
        for (Match match : stale) {
            finalizeSingleReport(match);
        }
    }

    private void finalizeSingleReport(Match match) {
        RideRequest ride = match.getRideRequest();
        User owner = ride.getUser();
        User responder = match.getResponder();
        boolean ownerIsDriver = ride.getRole() == Role.DRIVER;

        // Берём отчёт той стороны, которая есть; вторую считаем подтвердившей её
        OutcomeReport report = match.getDriverOutcome() != null ? match.getDriverOutcome() : match.getPassengerOutcome();
        match.setDriverOutcome(report);
        match.setPassengerOutcome(report);

        if (report == OutcomeReport.COMPLETED) {
            match.setStatus(MatchStatus.COMPLETED);
            User driver = ownerIsDriver ? owner : responder;
            User passenger = ownerIsDriver ? responder : owner;
            driver.setTripCount((driver.getTripCount() != null ? driver.getTripCount() : 0) + 1);
            passenger.setTripCount((passenger.getTripCount() != null ? passenger.getTripCount() : 0) + 1);
            userRepository.save(driver);
            userRepository.save(passenger);
        } else {
            User guilty = report == OutcomeReport.NO_SHOW_PASSENGER
                    ? (ownerIsDriver ? responder : owner)
                    : (ownerIsDriver ? owner : responder);
            guilty.setNoShowCount((guilty.getNoShowCount() != null ? guilty.getNoShowCount() : 0) + 1);
            userRepository.save(guilty);
            match.setStatus(report == OutcomeReport.NO_SHOW_PASSENGER
                    ? MatchStatus.NO_SHOW_PASSENGER
                    : MatchStatus.NO_SHOW_DRIVER);
            releaseSeatsAndRide(match);
        }

        matchRepository.save(match);
        notify(owner, "Исход поездки зафиксирован автоматически: " + match.getStatus().name());
        notify(responder, "Исход поездки зафиксирован автоматически: " + match.getStatus().name());
    }

    // ---------- Уведомления об откликах ----------

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

    @Transactional(readOnly = true)
    public long getOwnerPendingResponseCount(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return matchRepository.findByRideRequestUserId(user.getId()).stream()
                .filter(m -> m.getStatus() == MatchStatus.PENDING)
                .count();
    }

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

    // ---------- DTO ----------

    public List<MatchDTO> getMyResponses(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return matchRepository.findByResponderId(user.getId())
                .stream()
                .map(match -> toMatchDTO(match, false, user))
                .toList();
    }

    public List<MatchDTO> getResponsesForRequest(Long rideRequestId, Long ownerTelegramId) {
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));
        if (!rideRequest.getUser().getTelegramId().equals(ownerTelegramId)) {
            throw new RuntimeException("Вы не владелец этой заявки");
        }

        // 1. Достаем текущего пользователя из базы (того, кто смотрит отклики)
        User user = userRepository.findByTelegramId(ownerTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        // 2. Передаем его в маппер
        return matchRepository.findByRideRequestId(rideRequestId)
                .stream()
                .map(match -> toMatchDTO(match, true, user))
                .toList();
    }

    private MatchDTO toMatchDTO(Match match, boolean forOwner, User currentUser) {
        User owner = match.getRideRequest().getUser();
        User responder = match.getResponder();
        RideRequest ride = match.getRideRequest();

        String contactUsername = forOwner
                ? (responder.getUsername() != null && !responder.getUsername().isEmpty() ? responder.getUsername() : String.valueOf(responder.getTelegramId()))
                : (owner.getUsername() != null && !owner.getUsername().isEmpty() ? owner.getUsername() : String.valueOf(owner.getTelegramId()));

        String ownerName = (owner.getFirstName() != null ? owner.getFirstName() : "Пользователь") + (owner.getLastName() != null ? " " + owner.getLastName() : "");
        String responderName = (responder.getFirstName() != null ? responder.getFirstName() : "Пользователь") + (responder.getLastName() != null ? " " + responder.getLastName() : "");

        boolean hasReviewed = reviewRepository.existsByRideRequestIdAndReviewerId(
                match.getRideRequest().getId(), currentUser.getId()
        );

        return new MatchDTO(
                match.getId(),
                ride.getId(),

                responderName,
                responder.getTelegramId(),
                responder.getRating(),
                responder.getTripCount(),

                ownerName,
                owner.getTelegramId(),
                owner.getRating(),
                owner.getTripCount(),

                ride.getFromLocation().getY(), ride.getFromLocation().getX(),
                ride.getToLocation().getY(), ride.getToLocation().getX(),
                ride.getDepartureTime(),
                ride.getPricePerSeat(),
                ride.getNote(),

                match.getSeats(),
                match.getStatus().name(),
                match.getCreatedAt(),
                contactUsername,
                hasReviewed
        );
    }

    // ---------- Вспомогательное ----------

    private void notify(User user, String text) {
        if (user != null && user.getChatId() != null) {
            telegramBotService.sendMessage(user.getChatId(), text);
        }
    }


    @Scheduled(fixedRate = 60_000)
    @Transactional
    public void expirePastMatches() {
        LocalDateTime now = LocalDateTime.now();
        // Ищем PENDING и CONFIRMING матчи (берем с запасом по времени)
        List<Match> pendingMatches = matchRepository.findByStatusInAndRideRequestDepartureTimeBefore(
                List.of(MatchStatus.PENDING, MatchStatus.CONFIRMING), now);

        for (Match match : pendingMatches) {
            RideRequest ride = match.getRideRequest();
            int flex = ride.getTimeFlexibilityMinutes() != null ? ride.getTimeFlexibilityMinutes() : 30;

            // Если время выезда + гибкость уже прошли
            if (ride.getDepartureTime().plusMinutes(flex).isBefore(now)) {
                if (match.getStatus() == MatchStatus.CONFIRMING && ride.getRole() == Role.DRIVER) {
                    rideRequestRepository.incrementSeats(ride.getId(), match.getSeats());
                }
                match.setStatus(MatchStatus.REJECTED);
                matchRepository.save(match);

                if (match.getId().equals(ride.getAcceptedMatchId())) {
                    ride.setAcceptedMatchId(null);
                    ride.setStatus(RideStatus.EXPIRED);
                    rideRequestRepository.save(ride);
                }
            }
        }
    }
}
