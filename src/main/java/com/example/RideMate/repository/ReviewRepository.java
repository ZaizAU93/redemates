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

    // Отзывы о человеке, свежие сверху — для блока отзывов в «Деталях заявки»
    List<Review> findByReviewedOrderByCreatedAtDesc(User reviewed);

    @Query("SELECT r FROM Review r WHERE r.rideRequest.id = :rideRequestId AND r.reviewer.id = :reviewerId")
    Optional<Review> findByRideRequestIdAndReviewerId(@Param("rideRequestId") Long rideRequestId,
                                                      @Param("reviewerId") Long reviewerId);

    boolean existsByRideRequestIdAndReviewerId(Long rideRequestId, Long reviewerId);

    @Query("SELECT AVG(r.rating) FROM Review r WHERE r.reviewed.id = :userId")
    Double getAverageRatingByUserId(@Param("userId") Long userId);

    @Query("SELECT COUNT(r) FROM Review r WHERE r.reviewed.id = :userId")
    long countByReviewedId(@Param("userId") Long userId);
}
