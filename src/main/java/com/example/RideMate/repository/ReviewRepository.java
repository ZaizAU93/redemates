package com.example.RideMate.repository;

import com.example.RideMate.entity.Review;
import com.example.RideMate.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ReviewRepository extends JpaRepository<Review, Long> {

    // Отзывы о человеке (без сортировки)
    List<Review> findByReviewed(User reviewed);

    // Отзывы о человеке, свежие сверху
    List<Review> findByReviewedOrderByCreatedAtDesc(User reviewed);

    // Поиск отзыва по заявке и автору
    @Query("SELECT r FROM Review r WHERE r.rideRequest.id = :rideRequestId AND r.reviewer.id = :reviewerId")
    Optional<Review> findByRideRequestIdAndReviewerId(@Param("rideRequestId") Long rideRequestId,
                                                      @Param("reviewerId") Long reviewerId);

    // Проверка существования отзыва
    boolean existsByRideRequestIdAndReviewerId(Long rideRequestId, Long reviewerId);

    // Средний рейтинг пользователя
    @Query("SELECT AVG(r.rating) FROM Review r WHERE r.reviewed.id = :userId")
    Double getAverageRatingByUserId(@Param("userId") Long userId);

    // Количество отзывов о пользователе
    @Query("SELECT COUNT(r) FROM Review r WHERE r.reviewed.id = :userId")
    long countByReviewedId(@Param("userId") Long userId);
}