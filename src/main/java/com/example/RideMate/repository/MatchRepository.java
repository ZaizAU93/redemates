package com.example.RideMate.repository;

import com.example.RideMate.entity.Match;
import com.example.RideMate.entity.MatchStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface MatchRepository extends JpaRepository<Match, Long> {
    boolean existsByRideRequestIdAndResponderId(Long rideRequestId, Long responderId);
    List<Match> findByRideRequestId(Long rideRequestId);
    List<Match> findByResponderId(Long responderId);
    List<Match> findByRideRequestUserId(Long userId);
    List<Match> findByRideRequestIdAndStatus(Long rideRequestId, MatchStatus status);
    List<Match> findByStatusAndExpiresAtBefore(MatchStatus status, LocalDateTime time);
}
