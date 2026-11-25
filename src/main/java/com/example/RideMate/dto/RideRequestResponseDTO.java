package com.example.RideMate.dto;

import java.time.LocalDateTime;

public record RideRequestResponseDTO(
        Long id,
        String role,
        double fromLat,
        double fromLon,
        double toLat,
        double toLon,
        LocalDateTime departureTime,
        Integer passengerCount,
        Integer availableSeats,
        String note,
        Integer timeFlexibilityMinutes,
        String status,
        java.util.List<RoutePointDTO> waypoints
) {
}
