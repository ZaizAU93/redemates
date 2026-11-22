package com.example.RideMate.service;

import com.example.RideMate.dto.RideRequestCreateRequest;
import com.example.RideMate.dto.RideRequestDTO;
import com.example.RideMate.dto.RideRequestDetailsDTO;
import com.example.RideMate.dto.RideRequestMatchDTO;
import com.example.RideMate.dto.RideRequestResponseDTO;
import com.example.RideMate.dto.RoutePointDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.RouteSubscriptionRepository;
import com.example.RideMate.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class RideRequestService {

    private final RideRequestRepository rideRequestRepository;
    private final UserRepository userRepository;
    private final TelegramBotService telegramBotService;
    private final VehicleService vehicleService;
    private final MatchRepository matchRepository;
    private final GeometryFactory geometryFactory; // бин с SRID 4326 из GeoConfig
    private final RouteService routeService;

    private final RouteSubscriptionRepository routeSubscriptionRepository;

    @Transactional
    public RideRequestResponseDTO createRequest(RideRequestCreateRequest request, Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        // Проверка: есть ли активная заявка у этого пользователя
        Optional<RideRequest> activeRequest = rideRequestRepository
                .findFirstByUserIdAndStatus(user.getId(), RideStatus.ACTIVE);
        if (activeRequest.isPresent()) {
            throw new RuntimeException("У вас уже есть активная заявка. Отмените её или отредактируйте.");
        }

        RideRequest rideRequest = buildFromRequest(new RideRequest(), request, user);
        RideRequest saved = rideRequestRepository.save(rideRequest);

        if (request.role() == Role.DRIVER) {
            notifySubscribers(saved, user);
        }

        // Поиск совместимых заявок противоположной роли для мгновенных уведомлений
        Role oppositeRole = (request.role() == Role.PASSENGER) ? Role.DRIVER : Role.PASSENGER;
        List<RideRequest> compatible = rideRequestRepository.findCompatibleRequests(
                oppositeRole.name(),
                request.fromLat(), request.fromLon(),
                request.toLat(), request.toLon(),
                5000, 5000, 10
        );

        for (RideRequest r : compatible) {
            Long chatId = r.getUser().getChatId();
            if (chatId != null && !r.getUser().getTelegramId().equals(telegramId)) {
                String message = String.format(
                        "🔔 Новая заявка от %s %s\nОткуда: (%.4f, %.4f)\nКуда: (%.4f, %.4f)\nВремя: %s",
                        user.getFirstName(),
                        user.getLastName() != null ? user.getLastName() : "",
                        request.fromLat(), request.fromLon(),
                        request.toLat(), request.toLon(),
                        request.departureTime() != null ? request.departureTime().toString() : "не указано"
                );
                telegramBotService.sendMessage(chatId, message);
            }
        }

        return toDTO(saved);
    }

    /**
     * Редактирование своей активной заявки.
     * Меняются все основные поля; маршрут водителя пересобирается из новых точек.
     */
    @Transactional
    public RideRequestResponseDTO editRequest(Long telegramId, Long requestId, RideRequestCreateRequest request) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        RideRequest ride = rideRequestRepository.findById(requestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        if (!ride.getUser().getId().equals(user.getId())) {
            throw new RuntimeException("Можно редактировать только свою заявку");
        }
        if (ride.getStatus() != RideStatus.ACTIVE) {
            throw new RuntimeException("Редактировать можно только активную заявку");
        }

        buildFromRequest(ride, request, user);
        RideRequest saved = rideRequestRepository.save(ride);

        if (request.role() == Role.DRIVER) {
            notifySubscribers(saved, user);
        }
        return toDTO(saved);
    }

    /** Общая логика заполнения заявки для создания и редактирования. */
    private RideRequest buildFromRequest(RideRequest rideRequest, RideRequestCreateRequest request, User user) {
        rideRequest.setUser(user);
        rideRequest.setRole(request.role());

        Point from = geometryFactory.createPoint(new Coordinate(request.fromLon(), request.fromLat()));
        Point to = geometryFactory.createPoint(new Coordinate(request.toLon(), request.toLat()));
        rideRequest.setFromLocation(from);
        rideRequest.setToLocation(to);
        rideRequest.setDepartureTime(request.departureTime());
        rideRequest.setPassengerCount(request.passengerCount());
        rideRequest.setAvailableSeats(request.availableSeats());
        rideRequest.setNote(request.note());
        rideRequest.setReminderSent(false);
        rideRequest.setTimeFlexibilityMinutes(
                request.timeFlexibilityMinutes() != null ? request.timeFlexibilityMinutes() : 30
        );

        // Маршрут по дорогам через OSRM: from → промежуточные точки → to.
        // Если OSRM недоступен — RouteService сам откатится на прямую линию через те же точки.
        // Маршрут строится у водителя всегда, даже без промежуточных точек.
        if (request.role() == Role.DRIVER) {
            List<double[]> wp = new ArrayList<>();
            if (request.waypoints() != null) {
                for (RoutePointDTO w : request.waypoints()) {
                    wp.add(new double[]{w.lat(), w.lon()});
                }
            }
            rideRequest.setRoute(routeService.buildRoute(from, wp, to));
        } else {
            rideRequest.setRoute(null);
        }

        if (request.role() == Role.DRIVER && request.pricePerSeat() != null) {
            if (request.pricePerSeat().compareTo(java.math.BigDecimal.ZERO) < 0) {
                throw new RuntimeException("Цена не может быть отрицательной");
            }
            if (request.pricePerSeat().compareTo(new java.math.BigDecimal("500")) > 0) {
                throw new RuntimeException("Цена выглядит некорректной (максимум 500 BYN)");
            }
            rideRequest.setPricePerSeat(request.pricePerSeat());
        } else if (request.role() == Role.PASSENGER) {
            rideRequest.setPricePerSeat(null);
        }

        // Мест в заявке не больше, чем в машине водителя
        if (request.role() == Role.DRIVER && request.availableSeats() != null) {
            Vehicle vehicle = vehicleService.getVehicleForUser(user.getTelegramId());
            if (vehicle != null && request.availableSeats() > vehicle.getSeats()) {
                throw new RuntimeException("В вашей машине только " + vehicle.getSeats() + " мест");
            }
        }

        return rideRequest;
    }

    private void notifySubscribers(RideRequest ride, User driver) {
        List<RouteSubscription> subs = routeSubscriptionRepository.findMatchingSubscriptions(
                ride.getFromLocation().getY(), ride.getFromLocation().getX(),
                ride.getToLocation().getY(), ride.getToLocation().getX());
        for (RouteSubscription sub : subs) {
            User subscriber = sub.getUser();
            if (subscriber.getTelegramId().equals(driver.getTelegramId())) continue;
            Long chatId = subscriber.getChatId();
            if (chatId != null) {
                telegramBotService.sendMessage(chatId, String.format(
                        "🔔 Новая поездка по вашему маршруту!\n%s %s\n%s → %s\n%s",
                        driver.getFirstName(),
                        driver.getLastName() != null ? driver.getLastName() : "",
                        "от заданной точки", "к заданной точке",
                        ride.getDepartureTime() != null ? ride.getDepartureTime().toString() : "время уточняется"
                ));
            }
        }
    }

    public List<RideRequestDTO> getUserRequests(Long telegramId, RideStatus status) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        List<RideRequest> requests;
        if (status != null) {
            requests = rideRequestRepository.findByUserIdAndStatus(user.getId(), status);
        } else {
            requests = rideRequestRepository.findByUserId(user.getId());
        }
        return requests.stream()
                .map(this::toRideRequestDTO)
                .toList();
    }

    /** Полные детали заявки — для модалки «Детали». */
    @Transactional(readOnly = true)
    public RideRequestDetailsDTO getDetails(Long requestId, Long viewerTelegramId) {
        RideRequest r = rideRequestRepository.findById(requestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        User owner = r.getUser();
        Vehicle vehicle = null;
        if (r.getRole() == Role.DRIVER) {
            vehicle = vehicleService.getVehicleForUser(owner.getTelegramId());
        }

        String ownerName = owner.getFirstName() != null && !owner.getFirstName().isBlank()
                ? owner.getFirstName() : "Пользователь";
        if (owner.getLastName() != null && !owner.getLastName().isBlank()) {
            ownerName += " " + owner.getLastName();
        }

        boolean isMine = viewerTelegramId != null && owner.getTelegramId().equals(viewerTelegramId);

        return new RideRequestDetailsDTO(
                r.getId(),
                r.getRole().name(),
                r.getFromLocation().getY(),
                r.getFromLocation().getX(),
                r.getToLocation().getY(),
                r.getToLocation().getX(),
                r.getDepartureTime(),
                r.getPassengerCount(),
                r.getAvailableSeats(),
                r.getNote(),
                r.getTimeFlexibilityMinutes(),
                r.getStatus().name(),
                r.getCreatedAt(),
                r.getPricePerSeat(),
                ownerName,
                owner.getUsername(),
                owner.getTelegramId(),
                owner.getRating(),
                owner.getTripCount(),
                vehicle != null ? vehicle.getBrand() : null,
                vehicle != null ? vehicle.getModel() : null,
                vehicle != null ? vehicle.getColor() : null,
                vehicle != null ? vehicle.getSeats() : null,
                isMine
        );
    }

    /**
     * Поиск совместимых заявок.
     *
     * @param role             роль ТЕХ, КОГО ищем (для пассажира — DRIVER, для водителя — PASSENGER)
     * @param myRideRequestId  id своей активной заявки (для водителя — чтобы взять его маршрут); может быть null
     * @param viewerTelegramId telegramId того, кто ищет — чтобы не предлагать ему его же заявки
     */
    public List<RideRequestMatchDTO> findCompatibleAsDTO(
            Role role,
            double fromLat, double fromLon,
            double toLat, double toLon,
            double fromRadiusMeters, double toRadiusMeters,
            LocalDateTime departureTime,
            int limit,
            int flexibilityMinutes,
            Long myRideRequestId,
            Long viewerTelegramId
    ) {
        List<RideRequest> requests;

        if (role == Role.DRIVER) {
            // Ищет пассажир: сначала заявки водителей «по пути», затем точка-в-точку как резерв
            requests = rideRequestRepository.findRequestsAlongRoute(
                    fromLat, fromLon, toLat, toLon, fromRadiusMeters, toRadiusMeters, limit);
            if (requests.size() < 3) {
                List<RideRequest> fallback = rideRequestRepository.findCompatibleRequests(
                        role.name(), fromLat, fromLon, toLat, toLon,
                        fromRadiusMeters, toRadiusMeters, limit);
                // объединяем без дублей, приоритет у маршрутных
                var seen = new java.util.HashSet<Long>();
                var merged = new java.util.ArrayList<RideRequest>();
                for (RideRequest r : requests) {
                    if (seen.add(r.getId())) merged.add(r);
                }
                for (RideRequest r : fallback) {
                    if (seen.add(r.getId())) merged.add(r);
                }
                requests = merged.stream().limit(limit).toList();
            }
        } else {
            // Ищет водитель: пассажиры рядом с его маршрутом (если маршрут задан) или точечно
            RideRequest myRide = null;
            if (myRideRequestId != null) {
                myRide = rideRequestRepository.findById(myRideRequestId).orElse(null);
            }
            if (myRide != null && myRide.getRoute() != null) {
                requests = rideRequestRepository.findPassengersAlongRoute(
                        myRide.getRoute(), fromRadiusMeters, toRadiusMeters, limit);
            } else {
                requests = rideRequestRepository.findCompatibleRequests(
                        role.name(), fromLat, fromLon, toLat, toLon,
                        fromRadiusMeters, toRadiusMeters, limit);
            }
        }

        // Фильтр: не предлагаем пользователю его собственные заявки
        requests = requests.stream()
                .filter(r -> !r.getUser().getTelegramId().equals(viewerTelegramId))
                .toList();

        List<RideRequest> filtered = requests.stream()
                .filter(r -> r.getDepartureTime() == null || departureTime == null ||
                        Math.abs(Duration.between(r.getDepartureTime(), departureTime).toMinutes())
                                <= Math.max(flexibilityMinutes,
                                r.getTimeFlexibilityMinutes() != null ? r.getTimeFlexibilityMinutes() : 0))
                // У пассажиров availableSeats не заполняется — считаем, что мест на всех хватает
                .filter(r -> r.getRole() != Role.DRIVER ||
                        (r.getAvailableSeats() != null && r.getAvailableSeats() > 0))
                .toList();

        return filtered.stream()
                .map(r -> toMatchDTO(r, fromLat, fromLon, toLat, toLon, departureTime))
                .filter(dto -> dto.score() >= 40) // порог осмысленности: отсекаем «едет совсем не туда»
                .sorted(Comparator.comparingDouble(RideRequestMatchDTO::score).reversed())
                .toList();
    }

    @Transactional
    public void cancelRequest(Long telegramId, Long requestId) {
        int updated = rideRequestRepository.cancelRequest(requestId, telegramId);
        if (updated == 0) {
            throw new RuntimeException("Заявка не найдена или вы не можете её отменить");
        }
    }

    private RideRequestResponseDTO toDTO(RideRequest rideRequest) {
        return new RideRequestResponseDTO(
                rideRequest.getId(),
                rideRequest.getRole().name(),
                rideRequest.getFromLocation().getY(),
                rideRequest.getFromLocation().getX(),
                rideRequest.getToLocation().getY(),
                rideRequest.getToLocation().getX(),
                rideRequest.getDepartureTime(),
                rideRequest.getPassengerCount(),
                rideRequest.getAvailableSeats(),
                rideRequest.getNote(),
                rideRequest.getTimeFlexibilityMinutes(),
                rideRequest.getStatus().name()
        );
    }

    private RideRequestMatchDTO toMatchDTO(RideRequest r, double requestFromLat, double requestFromLon,
                                           double requestToLat, double requestToLon, LocalDateTime requestTime) {
        String vehicleBrand = null;
        String vehicleModel = null;
        String vehicleColor = null;
        Integer vehicleSeats = null;
        if (r.getRole() == Role.DRIVER) {
            Vehicle vehicle = vehicleService.getVehicleForUser(r.getUser().getTelegramId());
            if (vehicle != null) {
                vehicleBrand = vehicle.getBrand();
                vehicleModel = vehicle.getModel();
                vehicleColor = vehicle.getColor();
                vehicleSeats = vehicle.getSeats();
            }
        }

        double score = 100.0;

        // Расхождение «Откуда»
        double dist = calculateDistance(requestFromLat, requestFromLon,
                r.getFromLocation().getY(), r.getFromLocation().getX());
        score -= Math.min(dist / 1000.0 * 0.4, 20);

        // Расхождение «Куда»: едешь в другую сторону — сильно минусуем
        double toDist = calculateDistance(requestToLat, requestToLon,
                r.getToLocation().getY(), r.getToLocation().getX());
        score -= Math.min(toDist / 1000.0 * 0.5, 45);

        // Отклонение ТОЧЕК ИЩУЩЕГО от маршрута кандидата.
        // Раньше сравнивались точки кандидата с его же маршрутом — штраф всегда был около нуля.
        if (r.getRoute() != null) {
            Point myFrom = geometryFactory.createPoint(new Coordinate(requestFromLon, requestFromLat));
            Point myTo = geometryFactory.createPoint(new Coordinate(requestToLon, requestToLat));
            double dev = Math.min(
                    deviationMeters(myFrom, r.getRoute()),
                    deviationMeters(myTo, r.getRoute()));
            score -= Math.min(dev / 1000.0 * 0.5, 25);
        }

        if (r.getDepartureTime() != null && requestTime != null) {
            long diffMin = Math.abs(Duration.between(r.getDepartureTime(), requestTime).toMinutes());
            score -= Math.min(diffMin * 0.2, 20);
        }

        User u = r.getUser();
        if (u.getRating() != null && u.getRating() > 4.0) {
            score += Math.min((u.getRating() - 4.0) * 10, 10);
        }

        score = Math.max(0, Math.min(100, score));

        return new RideRequestMatchDTO(
                r.getId(),
                r.getUser().getFirstName() != null && !r.getUser().getFirstName().isBlank()
                        ? r.getUser().getFirstName() : "Пользователь",
                r.getRole().name(),
                r.getFromLocation().getY(),
                r.getFromLocation().getX(),
                r.getToLocation().getY(),
                r.getToLocation().getX(),
                r.getDepartureTime(),
                r.getPassengerCount(),
                r.getAvailableSeats(),
                r.getNote(),
                r.getCreatedAt(),
                r.getUser().getTelegramId(),
                vehicleBrand,
                vehicleModel,
                vehicleColor,
                vehicleSeats,
                r.getTimeFlexibilityMinutes(),
                score,
                r.getPricePerSeat()
        );
    }

    /**
     * Приближённое расстояние от точки до маршрута (в метрах).
     * Считаем по ближайшей вершине полилинии — для скоринга MVP достаточно.
     */
    private double deviationMeters(Point p, LineString route) {
        if (p == null || route == null) return 0;
        double metersPerDegLat = 111_320.0;
        double metersPerDegLon = 111_320.0 * Math.cos(Math.toRadians(p.getY()));
        double best = Double.MAX_VALUE;
        for (Coordinate c : route.getCoordinates()) {
            double dx = (p.getX() - c.x) * metersPerDegLon;
            double dy = (p.getY() - c.y) * metersPerDegLat;
            double d = Math.sqrt(dx * dx + dy * dy);
            if (d < best) best = d;
        }
        return best;
    }

    private double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        double earthRadius = 6371000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadius * c;
    }

    private RideRequestDTO toRideRequestDTO(RideRequest r) {
        return new RideRequestDTO(
                r.getId(),
                r.getRole().name(),
                r.getFromLocation().getY(),
                r.getFromLocation().getX(),
                r.getToLocation().getY(),
                r.getToLocation().getX(),
                r.getDepartureTime(),
                r.getPassengerCount(),
                r.getAvailableSeats(),
                r.getNote(),
                r.getTimeFlexibilityMinutes(),
                r.getStatus().name(),
                r.getCreatedAt(),
                r.getAcceptedMatchId(),
                r.getPricePerSeat()
        );
    }

    @Transactional
    public void completeRide(Long rideRequestId, Long telegramId) {
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));
        if (!rideRequest.getUser().getTelegramId().equals(telegramId)) {
            throw new RuntimeException("Только владелец заявки может завершить поездку");
        }
        if (rideRequest.getStatus() != RideStatus.MATCHED) {
            throw new RuntimeException("Поездка не находится в статусе MATCHED");
        }
        if (rideRequest.getAcceptedMatchId() != null) {
            Match match = matchRepository.findById(rideRequest.getAcceptedMatchId()).orElse(null);
            if (match == null || match.getStatus() != MatchStatus.CONFIRMED) {
                throw new RuntimeException("Бронь не подтверждена");
            }
        }

        rideRequest.setStatus(RideStatus.COMPLETED);
        rideRequestRepository.save(rideRequest);

        User owner = rideRequest.getUser();
        owner.setTripCount((owner.getTripCount() == null ? 0 : owner.getTripCount()) + 1);
        userRepository.save(owner);

        if (rideRequest.getAcceptedMatchId() != null) {
            Match match = matchRepository.findById(rideRequest.getAcceptedMatchId()).orElse(null);
            if (match != null) {
                match.setStatus(MatchStatus.COMPLETED);
                matchRepository.save(match);

                User responder = match.getResponder();
                responder.setTripCount((responder.getTripCount() == null ? 0 : responder.getTripCount()) + 1);
                userRepository.save(responder);
            }
        }
    }

    @Scheduled(fixedRate = 60000)
    @Transactional
    public void expireOldRequests() {
        List<RideRequest> expired = rideRequestRepository.findByStatusAndDepartureTimeBefore(RideStatus.ACTIVE, LocalDateTime.now());
        for (RideRequest r : expired) {
            r.setStatus(RideStatus.EXPIRED);
            rideRequestRepository.save(r);
        }
    }
}
