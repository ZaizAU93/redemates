package com.example.RideMate.entity;

import jakarta.persistence.*;
import lombok.Data;
import org.locationtech.jts.geom.Point;

import java.time.LocalDateTime;

@Entity
@Table(name = "ride_requests")
@Data
public class RideRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    @Column(name = "from_location", columnDefinition = "geography(Point,4326)")
    private Point fromLocation;

    @Column(name = "to_location", columnDefinition = "geography(Point,4326)")
    private Point toLocation;

    @Column(name = "departure_time")
    private LocalDateTime departureTime;

    @Column(name = "passenger_count")
    private Integer passengerCount;

    @Column(name = "available_seats")
    private Integer availableSeats;

    @Column(length = 500)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RideStatus status = RideStatus.ACTIVE;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "accepted_match_id")
    private Long acceptedMatchId;


    @Column(name = "reminder_sent", columnDefinition = "boolean default false")
    private Boolean reminderSent = false;

    @Column(name = "time_flexibility_minutes")
    private Integer timeFlexibilityMinutes = 30; // по умолчанию 30 минут
}