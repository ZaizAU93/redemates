package com.example.RideMate.entity;

import jakarta.persistence.*;
import lombok.*;
import org.locationtech.jts.geom.Point;
import java.time.LocalDateTime;

@Entity
@Table(name = "route_subscriptions")
@Getter @Setter @NoArgsConstructor
public class RouteSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "from_location", columnDefinition = "geography(Point,4326)", nullable = false)
    private Point fromLocation;

    @Column(name = "to_location", columnDefinition = "geography(Point,4326)", nullable = false)
    private Point toLocation;

    @Column(name = "radius_meters", nullable = false)
    private Integer radiusMeters = 5000;

    @Column(nullable = false)
    private Boolean active = true;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();
}
