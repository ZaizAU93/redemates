package com.example.RideMate.dto;

import java.time.LocalDateTime;

public record ChatDTO(
        Long matchId,
        Long rideRequestId,
        String peerName,
        String peerUsername,
        Long peerTelegramId,
        String lastMessageText,
        LocalDateTime lastMessageTime,
        long unreadCount,
        String status
) {
}
