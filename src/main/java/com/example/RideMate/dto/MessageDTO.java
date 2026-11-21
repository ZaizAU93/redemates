package com.example.RideMate.dto;

import java.time.LocalDateTime;

public record MessageDTO(
        Long id,
        Long matchId,
        Long senderTelegramId,
        String senderName,
        String text,
        LocalDateTime createdAt,
        boolean fromMe,
        boolean read
) {
}
