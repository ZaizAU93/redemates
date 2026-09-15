package com.example.RideMate.controller;


import com.example.RideMate.dto.MatchDTO;
import com.example.RideMate.dto.MatchResponseDTO;
import com.example.RideMate.service.MatchService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/matches")
@CrossOrigin
public class MatchController {

    private final MatchService matchService;
    private final TelegramAuthService authService;

    public MatchController(MatchService matchService, TelegramAuthService authService) {
        this.matchService = matchService;
        this.authService = authService;
    }

    @PostMapping("/{rideRequestId}/respond")
    public MatchResponseDTO respond(@PathVariable Long rideRequestId,
                                    @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return matchService.respondToRideRequest(rideRequestId, telegramId);
    }

    @GetMapping("/my")
    public List<MatchDTO> getMyResponses(
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return matchService.getMyResponses(telegramId);
    }

    @GetMapping("/for-request")
    public List<MatchDTO> getResponsesForRequest(
            @RequestParam Long rideRequestId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return matchService.getResponsesForRequest(rideRequestId, telegramId);
    }

    @PutMapping("/{matchId}/accept")
    public ResponseEntity<Void> acceptMatch(
            @PathVariable Long matchId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        matchService.acceptResponse(matchId, telegramId);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{matchId}/reject")
    public ResponseEntity<Void> rejectMatch(
            @PathVariable Long matchId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        matchService.rejectResponse(matchId, telegramId);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/{matchId}/cancel")
    public ResponseEntity<Void> cancelMatch(
            @PathVariable Long matchId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        matchService.cancelMatch(matchId, telegramId);
        return ResponseEntity.ok().build();
    }
}