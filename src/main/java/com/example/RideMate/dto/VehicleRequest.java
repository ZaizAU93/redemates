package com.example.RideMate.dto;

public record VehicleRequest(
        String brand,
        String model,
        String color,
        Integer seats,
        String plateNumber
) {
}