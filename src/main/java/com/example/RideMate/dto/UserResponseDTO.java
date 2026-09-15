package com.example.RideMate.dto;

public record UserResponseDTO(
        Long telegramId,
        String username,
        String firstName,
        String lastName,
        String role,
        Double rating,
        Integer tripCount,
        String vehicleBrand,
        String vehicleModel,
        String vehicleColor,
        Integer vehicleSeats
) {
}