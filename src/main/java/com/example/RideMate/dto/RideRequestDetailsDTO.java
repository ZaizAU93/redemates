package com.example.RideMate.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record RideRequestDetailsDTO(
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
        BigDecimal pricePerSeat,
        String ownerName,
        String ownerUsername,
        Long ownerTelegramId,
        Double ownerRating,
        Integer ownerTripCount,
        String vehicleBrand,
        String vehicleModel,
        String vehicleColor,
        Integer vehicleSeats,
        boolean isMine
) {
}
