package com.example.RideMate.service;

import com.example.RideMate.dto.VehicleRequest;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
public class VehicleService {

    private final VehicleRepository vehicleRepository;
    private final UserRepository userRepository;

    public VehicleService(VehicleRepository vehicleRepository,
                          UserRepository userRepository) {
        this.vehicleRepository = vehicleRepository;
        this.userRepository = userRepository;
    }

    @Transactional
    public Vehicle addOrUpdateVehicle(Long ownerTelegramId, VehicleRequest request) {
        User owner = userRepository.findByTelegramId(ownerTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        if (!owner.getRole().name().equals("DRIVER")) {
            throw new RuntimeException("Только водитель может добавить автомобиль");
        }

        Vehicle vehicle = vehicleRepository.findFirstByOwnerIdOrderByCreatedAtDesc(owner.getId());
        if (vehicle == null) {
            vehicle = new Vehicle();
            vehicle.setOwner(owner);
        }
        vehicle.setBrand(request.brand());
        vehicle.setModel(request.model());
        vehicle.setColor(request.color());
        vehicle.setSeats(request.seats());
        vehicle.setPlateNumber(request.plateNumber());
        vehicle.setUpdatedAt(LocalDateTime.now());
        return vehicleRepository.save(vehicle);
    }

    public Vehicle getVehicleForUser(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return vehicleRepository.findFirstByOwnerIdOrderByCreatedAtDesc(user.getId());
    }
}