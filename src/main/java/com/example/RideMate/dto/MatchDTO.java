package com.example.RideMate.dto;


import java.time.LocalDateTime;

public record MatchDTO(
        Long id,
        Long rideRequestId,
        String responderName,
        String status,
        LocalDateTime createdAt,
        String contactUsername,
        Long responderTelegramId
) {
}