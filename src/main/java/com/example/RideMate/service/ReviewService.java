package com.example.RideMate.service;

import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.ReviewRepository;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.UserRepository;
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

    /**
     * Возвращает telegramId второй стороны поездки — того, кому оставляют отзыв.
     * Отзыв можно оставить только участнику подтверждённой брони.
     */
    @Transactional(readOnly = true)
    public Long getCounterparty(Long rideRequestId, Long reviewerTelegramId) {
        RideRequest rideRequest = rideRequestRepository.findById(rideRequestId)
                .orElseThrow(() -> new RuntimeException("Заявка не найдена"));

        if (rideRequest.getStatus() != RideStatus.COMPLETED) {
            throw new RuntimeException("Отзыв можно оставить только после завершения поездки");
        }

        User owner = rideRequest.getUser();
        boolean isOwner = owner.getTelegramId().equals(reviewerTelegramId);

        Match match = null;
        if (rideRequest.getAcceptedMatchId() != null) {
            match = matchRepository.findById(rideRequest.getAcceptedMatchId()).orElse(null);
        }

        if (match == null ||
                (match.getStatus() != MatchStatus.CONFIRMED && match.getStatus() != MatchStatus.COMPLETED)) {
            throw new RuntimeException("Отзыв доступен только участникам подтверждённой поездки");
        }

        if (isOwner) {
            return match.getResponder().getTelegramId();
        }
        if (match.getResponder().getTelegramId().equals(reviewerTelegramId)) {
            return owner.getTelegramId();
        }
        throw new RuntimeException("Вы не участвовали в этой поездке");
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

        if (rating < 1 || rating > 5) {
            throw new RuntimeException("Оценка должна быть от 1 до 5");
        }

        // Участие и вторая сторона — единая проверка
        Long expectedTarget = getCounterparty(rideRequestId, reviewerTelegramId);
        if (!expectedTarget.equals(reviewedTelegramId)) {
            throw new RuntimeException("Можно оценить только собеседника по этой поездке");
        }

        // Один отзыв на заявку от одного участника (плюс ограничение в базе)
        if (reviewRepository.existsByRideRequestIdAndReviewerId(rideRequestId, reviewer.getId())) {
            throw new RuntimeException("Вы уже оставили отзыв по этой поездке");
        }

        Review review = new Review();
        review.setRideRequest(rideRequest);
        review.setReviewer(reviewer);
        review.setReviewed(reviewed);
        review.setRating(rating);
        review.setComment(comment);
        reviewRepository.save(review);

        // Пересчитываем только рейтинг; tripCount меняется только в completeRide
        Double avg = reviewRepository.getAverageRatingByUserId(reviewed.getId());
        if (avg != null) {
            reviewed.setRating(Math.round(avg * 10) / 10.0);
            userRepository.save(reviewed);
        }
    }

    @Transactional(readOnly = true)
    public List<Review> getReviewsForUser(Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return reviewRepository.findByReviewed(user);
    }
}
