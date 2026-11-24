package com.example.RideMate.dto;

import java.math.BigDecimal;
import java.time.LocalDateTime;

public record MatchDTO(
        Long id,
        Long rideRequestId,

        // Данные того, кто откликнулся
        String responderName,
        Long responderTelegramId,
        Double responderRating,
        Integer responderTripCount,

        // Данные владельца заявки
        String ownerName,
        Long ownerTelegramId,
        Double ownerRating,
        Integer ownerTripCount,

        // Детали маршрута
        double fromLat,
        double fromLon,
        double toLat,
        double toLon,
        LocalDateTime departureTime,
        BigDecimal pricePerSeat,
        String note,

        // Детали брони
        Integer seats,
        String status,
        LocalDateTime createdAt,
        String contactUsername,
        Boolean hasReviewed
) {}