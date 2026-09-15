package com.example.RideMate.repository;


import com.example.RideMate.entity.Vehicle;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface VehicleRepository extends JpaRepository<Vehicle, Long> {
    List<Vehicle> findByOwnerId(Long ownerId);
    Vehicle findFirstByOwnerIdOrderByCreatedAtDesc(Long ownerId);
}