package com.example.RideMate.dto;


import java.time.LocalDateTime;

public record RideRequestMatchDTO(
        Long id,
        String userName,
        String role,
        double fromLat,
        double fromLon,
        double toLat,
        double toLon,
        LocalDateTime departureTime,
        Integer passengerCount,
        Integer availableSeats,
        String note,
        LocalDateTime createdAt,
        Long userTelegramId,
        String vehicleBrand,
        String vehicleModel,
        String vehicleColor,
        Integer vehicleSeats,
        Integer timeFlexibilityMinutes,
        double score,

        java.math.BigDecimal pricePerSeat   // только для водителя, может быть null

) {
}