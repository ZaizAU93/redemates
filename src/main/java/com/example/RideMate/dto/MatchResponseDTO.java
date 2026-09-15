package com.example.RideMate.dto;

public record MatchResponseDTO(
        Long matchId,
        Long rideRequestId,
        String message
) {
}