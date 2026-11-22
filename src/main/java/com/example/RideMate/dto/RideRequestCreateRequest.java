package com.example.RideMate.dto;

import com.example.RideMate.entity.Role;

import java.time.LocalDateTime;

public record RideRequestCreateRequest(
        Role role,
        double fromLat,
        double fromLon,
        double toLat,
        double toLon,
        LocalDateTime departureTime,
        Integer passengerCount,
        Integer availableSeats,
        String note,
        Integer timeFlexibilityMinutes,
        java.util.List<RoutePointDTO> waypoints,
        java.math.BigDecimal pricePerSeat,   // только для водителя, может быть null

        Integer routeIndex



) {
}