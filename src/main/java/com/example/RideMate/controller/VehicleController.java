package com.example.RideMate.controller;


import com.example.RideMate.dto.VehicleRequest;
import com.example.RideMate.entity.Vehicle;
import com.example.RideMate.service.TelegramAuthService;
import com.example.RideMate.service.VehicleService;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/vehicles")
@CrossOrigin
public class VehicleController {

    private final VehicleService vehicleService;
    private final TelegramAuthService authService;

    public VehicleController(VehicleService vehicleService, TelegramAuthService authService) {
        this.vehicleService = vehicleService;
        this.authService = authService;
    }

    @PostMapping
    public Vehicle addOrUpdateVehicle(@RequestBody VehicleRequest request,
                                      @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long ownerTelegramId = authService.authenticate(initData);
        return vehicleService.addOrUpdateVehicle(ownerTelegramId, request);
    }

    @GetMapping
    public Vehicle getMyVehicle(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return vehicleService.getVehicleForUser(telegramId);
    }
}