package com.example.RideMate.dto;

public record LocationRequest(
        String name,
        double latitude,
        double longitude
) {
}