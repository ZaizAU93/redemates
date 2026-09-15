package com.example.RideMate.service;


import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;


@Service
public class ReviewService {

    private final ReviewRepository reviewRepository;
    private final UserRepository userRepository;
    private final RideRequestRepository rideRequestRepository;
    private final MatchRepository matchRepository;

    public ReviewService(ReviewRepository reviewRepository,
                         UserRepository userRepository,
                         RideRequestRepository rideRequestRepository,
                         MatchRepository matchRepository) {
        this.reviewRepository = reviewRepository;
        this.userRepository = userRepository;
        this.rideRequestRepository = rideRequestRepository;
        this.matchRepository = matchRepository;
    }

    @Transactional
    public void createReview(Long rideRequestId, Long reviewerTelegramId,
                             Long reviewedTelegramId, int rating, String comment) {
        User reviewer = userRepository.findByTelegramId(reviewerTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        User reviewed = userRepository.findByTelegramId(reviewedTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        if (rideRequest.getStatus() != RideStatus.COMPLETED) {
            throw new RuntimeException("Нельзя оставить отзыв до завершения поездки");
        }

        // Проверяем участие
        boolean isOwner = rideRequest.getUser().getTelegramId().equals(reviewerTelegramId);
        boolean isResponder = false;
        if (rideRequest.getAcceptedMatchId() != null) {
            Match match = matchRepository.findById(rideRequest.getAcceptedMatchId()).orElse(null);
            if (match != null && match.getResponder().getTelegramId().equals(reviewerTelegramId)) {
                isResponder = true;
            }
        }
        if (!isOwner && !isResponder) {
            throw new RuntimeException("Вы не участвовали в этой поездке");
        }

        // Проверяем, не оставлял ли уже отзыв
        if (reviewRepository.findByRideRequestIdAndReviewerId(rideRequestId, reviewer.getId()).isPresent()) {
            throw new RuntimeException("Вы уже оставили отзыв");
        }

        Review review = new Review();
        review.setRideRequest(rideRequest);
        review.setReviewer(reviewer);
        review.setReviewed(reviewed);
        review.setRating(rating);
        review.setComment(comment);
        reviewRepository.save(review);

        // Пересчитываем рейтинг
        double avg = reviewRepository.getAverageRating(reviewed);
        long count = reviewRepository.countByReviewed(reviewed);
        reviewed.setRating(avg);
        reviewed.setTripCount((int) count); // или оставить tripCount отдельным, но обновим количество оценок
        userRepository.save(reviewed);
    }

    public List<Review> getReviewsForUser(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return reviewRepository.findByReviewed(user);
    }
}