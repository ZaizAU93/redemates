package com.example.RideMate.dto;

import java.time.LocalDateTime;

public record RideRequestDTO(
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
        LocalDateTime createdAt,
        Long acceptedMatchId,
        java.math.BigDecimal pricePerSeat,  // только для водителя, может быть null
        Boolean hasReviewed

) {
}
