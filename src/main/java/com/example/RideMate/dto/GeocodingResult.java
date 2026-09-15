package com.example.RideMate.dto;

public record GeocodingResult(
        String displayName,
        double latitude,
        double longitude
) {
}