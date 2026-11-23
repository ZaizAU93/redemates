package com.example.RideMate.controller;

import com.example.RideMate.dto.MatchDTO;
import com.example.RideMate.dto.MatchResponseDTO;
import com.example.RideMate.entity.MatchStatus;
import com.example.RideMate.entity.OutcomeReport;
import com.example.RideMate.entity.User;
import com.example.RideMate.service.MatchService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
                                    @RequestParam(required = false) Integer seats,
                                    @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        return matchService.respondToRideRequest(rideRequestId, telegramId, seats);
    }

    @PutMapping("/{matchId}/confirm")
    public ResponseEntity<Void> confirmMatch(
            @PathVariable Long matchId,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        matchService.confirmResponse(matchId, telegramId);
        return ResponseEntity.ok().build();
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

    /** Id заявок с живым откликом пользователя + счётчик новых откликов на его заявки. */
    /** Данные для уведомлений: мои живые отклики, новые отклики на мои заявки, брони в подтверждении. */
    @GetMapping("/notifications")
    public Map<String, Object> getNotifications(
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("respondedRideIds", matchService.getMyRespondedRideRequestIds(telegramId));
        result.put("pendingResponsesCount", matchService.getOwnerPendingResponseCount(telegramId));
        result.put("confirmingCount", matchService.getConfirmingBookingCount(telegramId));
        return result;
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


    @PutMapping("/{matchId}/outcome")
    public ResponseEntity<?> reportOutcome(@PathVariable Long matchId,
                                           @RequestParam OutcomeReport outcome,
                                           @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        MatchStatus status = matchService.reportOutcome(matchId, telegramId, outcome);
        return ResponseEntity.ok(Map.of("status", status.name()));
    }


}
