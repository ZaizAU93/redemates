package com.example.RideMate.dto;

public record UserRegistrationRequest(
        Long telegramId,
        String username,
        String firstName,
        String lastName,
        String languageCode,
        Boolean isPremium
) {}