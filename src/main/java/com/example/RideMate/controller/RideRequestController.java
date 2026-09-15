package com.example.RideMate.controller;

import com.example.RideMate.dto.RideRequestCreateRequest;
import com.example.RideMate.dto.RideRequestDTO;
import com.example.RideMate.dto.RideRequestMatchDTO;
import com.example.RideMate.dto.RideRequestResponseDTO;
import com.example.RideMate.entity.RideStatus;
import com.example.RideMate.entity.Role;
import com.example.RideMate.service.RideRequestService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/rides")
@CrossOrigin
public class RideRequestController {

    private final RideRequestService rideRequestService;
    private final TelegramAuthService authService;

    public RideRequestController(RideRequestService rideRequestService,
                                 TelegramAuthService authService) {
        this.rideRequestService = rideRequestService;
        this.authService = authService;
    }

    @PostMapping
    public RideRequestResponseDTO create(@RequestBody RideRequestCreateRequest request,
                                         @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return rideRequestService.createRequest(request, telegramId);
    }

    @GetMapping("/matches")
    public List<RideRequestMatchDTO> findMatches(
            @RequestParam Role role,
            @RequestParam double fromLat,
            @RequestParam double fromLon,
            @RequestParam double toLat,
            @RequestParam double toLon,
            @RequestParam(required = false) String departureTime,
            @RequestParam(defaultValue = "5000") double fromRadiusMeters,
            @RequestParam(defaultValue = "5000") double toRadiusMeters,
            @RequestParam(defaultValue = "30") int flexibilityMinutes,   // <-- добавлено
            @RequestParam(defaultValue = "10") int limit,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        authService.authenticate(initData);
        Role oppositeRole = (role == Role.PASSENGER) ? Role.DRIVER : Role.PASSENGER;
        LocalDateTime depTime = null;
        if (departureTime != null && !departureTime.isEmpty()) {
            depTime = LocalDateTime.parse(departureTime);
        }
        return rideRequestService.findCompatibleAsDTO(
                oppositeRole, fromLat, fromLon, toLat, toLon,
                fromRadiusMeters, toRadiusMeters, depTime, limit, flexibilityMinutes  // <-- передача
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


}