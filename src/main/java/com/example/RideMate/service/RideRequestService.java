package com.example.RideMate.service;

import com.example.RideMate.dto.RideRequestCreateRequest;
import com.example.RideMate.dto.RideRequestDTO;
import com.example.RideMate.dto.RideRequestMatchDTO;
import com.example.RideMate.dto.RideRequestResponseDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
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
    private final GeometryFactory geometryFactory = new GeometryFactory();

    @Transactional
    public RideRequestResponseDTO createRequest(RideRequestCreateRequest request, Long telegramId) {
        System.out.println("=== Создание заявки ===");
        System.out.println("telegramId=" + telegramId);
        System.out.println("role=" + request.role());
        System.out.println("fromLat=" + request.fromLat() + ", fromLon=" + request.fromLon());
        System.out.println("toLat=" + request.toLat() + ", toLon=" + request.toLon());
        System.out.println("departureTime=" + request.departureTime());
        System.out.println("passengerCount=" + request.passengerCount());
        System.out.println("availableSeats=" + request.availableSeats());
        System.out.println("note=" + request.note());
        System.out.println("timeFlexibilityMinutes=" + request.timeFlexibilityMinutes());

        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        // Проверка: есть ли активная заявка у этого пользователя
        Optional<RideRequest> activeRequest = rideRequestRepository
                .findFirstByUserIdAndStatus(user.getId(), RideStatus.ACTIVE);
        if (activeRequest.isPresent()) {
            throw new RuntimeException("У вас уже есть активная заявка. Отмените её, чтобы создать новую.");
        }

        RideRequest rideRequest = new RideRequest();
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
        rideRequest.setStatus(RideStatus.ACTIVE);
        rideRequest.setReminderSent(false);
        rideRequest.setTimeFlexibilityMinutes(
                request.timeFlexibilityMinutes() != null ? request.timeFlexibilityMinutes() : 30
        );

        RideRequest saved = rideRequestRepository.save(rideRequest);
        System.out.println("Заявка сохранена, id=" + saved.getId());

        // Поиск совместимых заявок противоположной роли
        Role oppositeRole = (request.role() == Role.PASSENGER) ? Role.DRIVER : Role.PASSENGER;
        System.out.println("Поиск совместимых для oppositeRole=" + oppositeRole.name());
        List<RideRequest> compatible = rideRequestRepository.findCompatibleRequests(
                oppositeRole.name(),
                request.fromLat(), request.fromLon(),
                request.toLat(), request.toLon(),
                5000, 5000, 10
        );
        System.out.println("Найдено совместимых заявок: " + compatible.size());

        // Отправка уведомлений
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
                System.out.println("Отправлено уведомление пользователю с chatId=" + chatId);
            }
        }

        return toDTO(saved);
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

    public List<RideRequestMatchDTO> findCompatibleAsDTO(
            Role role,
            double fromLat, double fromLon,
            double toLat, double toLon,
            double fromRadiusMeters, double toRadiusMeters,
            LocalDateTime departureTime,
            int limit,
            int flexibilityMinutes
    ) {
        System.out.println("=== Поиск совместимых (DTO) ===");
        System.out.println("role=" + role + ", fromLat=" + fromLat + ", fromLon=" + fromLon + ", toLat=" + toLat + ", toLon=" + toLon);
        System.out.println("departureTime=" + departureTime);
        System.out.println("flexibilityMinutes=" + flexibilityMinutes);

        List<RideRequest> requests = rideRequestRepository.findCompatibleRequests(
                role.name(), fromLat, fromLon, toLat, toLon,
                fromRadiusMeters, toRadiusMeters, limit
        );
        System.out.println("Найдено заявок по координатам: " + requests.size());

        List<RideRequest> filtered = requests.stream()
                .filter(r -> r.getDepartureTime() == null || departureTime == null ||
                        Math.abs(Duration.between(r.getDepartureTime(), departureTime).toMinutes()) <= flexibilityMinutes)
                .filter(r -> {
                    if (role == Role.PASSENGER) {
                        return r.getAvailableSeats() != null && r.getAvailableSeats() > 0;
                    } else {
                        return true;
                    }
                })
                .toList();

        System.out.println("После фильтрации: " + filtered.size());

        return filtered.stream()
                .map(r -> toMatchDTO(r, fromLat, fromLon, departureTime))
                .sorted(Comparator.comparingDouble(RideRequestMatchDTO::score).reversed())
                .toList();
    }

    @Transactional
    public void cancelRequest(Long telegramId, Long requestId) {
        System.out.println("=== Отмена заявки ===");
        System.out.println("telegramId=" + telegramId + ", requestId=" + requestId);
        int updated = rideRequestRepository.cancelRequest(requestId, telegramId);
        if (updated == 0) {
            throw new RuntimeException("Заявка не найдена или вы не можете её отменить");
        }
        System.out.println("Заявка отменена");
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

    private RideRequestMatchDTO toMatchDTO(RideRequest r, double requestFromLat, double requestFromLon, LocalDateTime requestTime) {
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

        double dist = calculateDistance(requestFromLat, requestFromLon,
                r.getFromLocation().getY(), r.getFromLocation().getX());
        score -= Math.min(dist / 1000.0 * 0.4, 20);

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
                r.getUser().getFirstName() + " " + (r.getUser().getLastName() != null ? r.getUser().getLastName() : ""),
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
                score
        );
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
                r.getAcceptedMatchId()
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
        LocalDateTime now = LocalDateTime.now();
        List<RideRequest> expired = rideRequestRepository.findByStatusAndDepartureTimeBefore(RideStatus.ACTIVE, now);
        for (RideRequest r : expired) {
            r.setStatus(RideStatus.EXPIRED);
            rideRequestRepository.save(r);
        }
    }
}