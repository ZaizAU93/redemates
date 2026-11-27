package com.example.RideMate.controller;

import com.example.RideMate.entity.Review;
import com.example.RideMate.entity.User;
import com.example.RideMate.repository.ReviewRepository;
import com.example.RideMate.repository.UserRepository;
import com.example.RideMate.service.ReviewService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/reviews")
@CrossOrigin
public class ReviewController {

    private final ReviewService reviewService;
    private final ReviewRepository reviewRepository;
    private final UserRepository userRepository;
    private final TelegramAuthService authService;

    public ReviewController(ReviewService reviewService,
                            ReviewRepository reviewRepository,
                            UserRepository userRepository,
                            TelegramAuthService authService) {
        this.reviewService = reviewService;
        this.reviewRepository = reviewRepository;
        this.userRepository = userRepository;
        this.authService = authService;
    }

    @PostMapping
    public void createReview(@RequestBody CreateReviewRequest request,
                             @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long reviewerId = authService.authenticate(initData);
        reviewService.createReview(
                request.rideRequestId(),
                reviewerId,
                request.reviewedTelegramId(),
                request.rating(),
                request.comment()
        );
    }

    /*
    @GetMapping("/user/{telegramId}")
    public List<Map<String, Object>> getUserReviews(@PathVariable Long telegramId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        return reviewRepository.findByReviewedOrderByCreatedAtDesc(user).stream()
                .limit(10)
                .map(r -> {
                    User reviewer = r.getReviewer();
                    return Map.<String, Object>of(
                            "id", r.getId(),
                            "rating", r.getRating(),
                            "comment", r.getComment() != null ? r.getComment() : "",
                            "reviewerName", reviewer != null
                                    ? (reviewer.getFirstName() + " " + (reviewer.getLastName() != null ? reviewer.getLastName() : ""))
                                    : "Аноним",
                            "createdAt", r.getCreatedAt()
                    );
                })
                .collect(Collectors.toList());
    } */
    @GetMapping("/user/{telegramId}")
    public List<Map<String, Object>> getUserReviews(@PathVariable Long telegramId,
                                                    @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        authService.authenticate(initData);
        return reviewService.getReviewsAbout(telegramId);
    }
    @GetMapping("/counterparty/{rideRequestId}")
    public Long getCounterparty(@PathVariable Long rideRequestId,
                                @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return reviewService.getCounterparty(rideRequestId, telegramId);
    }

    @GetMapping("/about")
    public List<Map<String, Object>> getReviewsAbout(
            @RequestParam Long telegramId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        authService.authenticate(initData);
        return reviewService.getReviewsAbout(telegramId);
    }

    public record CreateReviewRequest(Long rideRequestId, Long reviewedTelegramId, int rating, String comment) {}
}