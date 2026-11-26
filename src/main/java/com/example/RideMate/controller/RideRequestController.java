package com.example.RideMate.controller;

import com.example.RideMate.dto.RideRequestCreateRequest;
import com.example.RideMate.dto.RideRequestDTO;
import com.example.RideMate.dto.RideRequestDetailsDTO;
import com.example.RideMate.dto.RideRequestMatchDTO;
import com.example.RideMate.dto.RideRequestResponseDTO;
import com.example.RideMate.entity.RideRequest;
import com.example.RideMate.entity.RideStatus;
import com.example.RideMate.entity.Role;
import com.example.RideMate.entity.User;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.service.RideRequestService;
import com.example.RideMate.service.TelegramAuthService;
import com.example.RideMate.service.UserService;
import lombok.Data;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/rides")
@CrossOrigin
@Data
public class RideRequestController {

    private final RideRequestService rideRequestService;
    private final TelegramAuthService authService;

    private final UserService userService;

    private final RideRequestRepository rideRequestRepository;


    @PostMapping
    public RideRequestResponseDTO create(@RequestBody RideRequestCreateRequest request,
                                         @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return rideRequestService.createRequest(request, telegramId);
    }

    /** Редактирование своей активной заявки. */
    @PutMapping("/{id}")
    public RideRequestResponseDTO edit(@PathVariable Long id,
                                       @RequestBody RideRequestCreateRequest request,
                                       @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return rideRequestService.editRequest(telegramId, id, request);
    }

    /** Полные детали заявки (профиль владельца, автомобиль водителя и т.д.). */
    @GetMapping("/{id}")
    public RideRequestDetailsDTO details(@PathVariable Long id,
                                         @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return rideRequestService.getDetails(id, telegramId);
    }

    @GetMapping("/matches")
    public List<RideRequestMatchDTO> findMatches(
            @RequestParam String role,
            @RequestParam double fromLat,
            @RequestParam double fromLon,
            @RequestParam double toLat,
            @RequestParam double toLon,
            @RequestParam(defaultValue = "5000") double fromRadiusMeters,
            @RequestParam(defaultValue = "5000") double toRadiusMeters,
            @RequestParam(required = false) String departureTime,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "30") int flexibilityMinutes,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {

        Long telegramId = authService.authenticate(initData);

        LocalDateTime time = null;
        if (departureTime != null && !departureTime.isBlank()) {
            time = LocalDateTime.parse(departureTime);
        }

        // id активной заявки текущего пользователя — для поиска «по пути» от лица водителя
        Long myRideRequestId = null;
        User user = userService.getUserByTelegramId(telegramId);
        RideRequest myRide = rideRequestRepository.findFirstByUserIdAndStatus(user.getId(), RideStatus.ACTIVE)
                .orElse(null);
        if (myRide != null) {
            myRideRequestId = myRide.getId();
        }

        return rideRequestService.findCompatibleAsDTO(
                Role.valueOf(role),
                fromLat, fromLon,
                toLat, toLon,
                fromRadiusMeters, toRadiusMeters,
                time, limit, flexibilityMinutes,
                myRideRequestId,
                telegramId
        );
    }

    @GetMapping("/my")
    public List<RideRequestDTO> getUserRequests(
            @RequestParam(required = false) String status,
            @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        RideStatus rideStatus = null;
        if (status != null && !status.isBlank()) {
            rideStatus = RideStatus.valueOf(status.toUpperCase());
        }
        return rideRequestService.getUserRequests(telegramId, rideStatus);
    }

    @PutMapping("/{id}/cancel")
    public ResponseEntity<Void> cancelRequest(
            @PathVariable Long id,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        rideRequestService.cancelRequest(telegramId, id);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{id}/complete")
    public ResponseEntity<Void> completeRide(@PathVariable Long id,
                                             @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        rideRequestService.completeRide(id, telegramId);
        return ResponseEntity.ok().build();
    }


    @GetMapping("/{id}/route")
    public List<double[]> getRoute(@PathVariable Long id) {
        return rideRequestService.getRouteCoords(id);
    }


    /** Предпросмотр альтернативных дорог: [[lat, lon], ...] для каждого варианта.
    @GetMapping("/alternatives")
    public List<List<double[]>> routeAlternatives(
            @RequestParam double fromLat, @RequestParam double fromLon,
            @RequestParam double toLat, @RequestParam double toLon,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String tgInitData) {
        Point from = new GeometryFactory(new PrecisionModel(), 4326)
                .createPoint(new Coordinate(fromLon, fromLat));
        Point to = new GeometryFactory(new PrecisionModel(), 4326)
                .createPoint(new Coordinate(toLon, toLat));
        return rideRequestService.getRouteAlternativesCoords(from, List.of(), to);

    }
     */

    /** Предпросмотр альтернативных дорог: [[lat, lon], ...] для каждого варианта. */
    @GetMapping("/alternatives")
    public List<List<double[]>> routeAlternatives(
            @RequestParam double fromLat, @RequestParam double fromLon,
            @RequestParam double toLat, @RequestParam double toLon,
            @RequestParam(required = false) List<String> waypoints, // <--- ДОБАВИЛИ ПАРАМЕТР
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String tgInitData) {

        Point from = new GeometryFactory(new PrecisionModel(), 4326)
                .createPoint(new Coordinate(fromLon, fromLat));
        Point to = new GeometryFactory(new PrecisionModel(), 4326)
                .createPoint(new Coordinate(toLon, toLat));

        // Парсим строки "lat,lon" в список точек
        List<double[]> wpList = new java.util.ArrayList<>();
        if (waypoints != null) {
            for (String wp : waypoints) {
                String[] parts = wp.split(",");
                if (parts.length == 2) {
                    wpList.add(new double[]{Double.parseDouble(parts[0]), Double.parseDouble(parts[1])});
                }
            }
        }

        return rideRequestService.getRouteAlternativesCoords(from, wpList, to);
    }

    @GetMapping("/nearby")
    public List<RideRequestResponseDTO> getNearbyRides(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam int radius,
            @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return rideRequestService.findNearbyRides(lat, lon, radius, telegramId);
    }
}
