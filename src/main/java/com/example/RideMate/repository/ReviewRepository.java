package com.example.RideMate.repository;



import com.example.RideMate.entity.Review;
import com.example.RideMate.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    List<Review> findByReviewed(User reviewed);
    Optional<Review> findByRideRequestIdAndReviewerId(Long rideRequestId, Long reviewerId);

    @Query("SELECT AVG(r.rating) FROM Review r WHERE r.reviewed = :user")
    Double getAverageRating(@Param("user") User user);

    @Query("SELECT COUNT(r) FROM Review r WHERE r.reviewed = :user")
    long countByReviewed(@Param("user") User user);
}