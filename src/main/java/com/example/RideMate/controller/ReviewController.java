package com.example.RideMate.controller;



import com.example.RideMate.entity.Review;
import com.example.RideMate.service.ReviewService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reviews")
@CrossOrigin
public class ReviewController {

    private final ReviewService reviewService;
    private final TelegramAuthService authService;

    public ReviewController(ReviewService reviewService, TelegramAuthService authService) {
        this.reviewService = reviewService;
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

    @GetMapping("/user/{telegramId}")
    public List<Review> getUserReviews(@PathVariable Long telegramId) {
        return reviewService.getReviewsForUser(telegramId);
    }

    public record CreateReviewRequest(Long rideRequestId, Long reviewedTelegramId, int rating, String comment) {}


    @GetMapping("/counterparty/{rideRequestId}")
    public Long getCounterparty(@PathVariable Long rideRequestId,
                                @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return reviewService.getCounterparty(rideRequestId, telegramId);
    }


    /** Отзывы о конкретном человеке — для показа в «Деталях заявки». */
    @GetMapping("/about")
    public List<Map<String, Object>> getReviewsAbout(
            @RequestParam Long telegramId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        authService.authenticate(initData);
        return reviewService.getReviewsAbout(telegramId);
    }

}