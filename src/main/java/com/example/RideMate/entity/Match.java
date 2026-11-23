package com.example.RideMate.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.time.LocalDateTime;

@Entity
@Table(name = "matches")
@Data
public class Match {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ride_request_id", nullable = false)
    private RideRequest rideRequest;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "responder_user_id", nullable = false)
    private User responder;

    @Column(nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MatchStatus status = MatchStatus.PENDING;

    @Column(nullable = false)
    private Integer seats = 1;

    @Column(name = "expires_at")
    private LocalDateTime expiresAt;

    @Column(name = "confirmed_at")
    private LocalDateTime confirmedAt;

    // Исход поездки: что отчиталась каждая из сторон
    @Enumerated(EnumType.STRING)
    @Column(name = "driver_outcome")
    private OutcomeReport driverOutcome;

    @Enumerated(EnumType.STRING)
    @Column(name = "passenger_outcome")
    private OutcomeReport passengerOutcome;
}
