package com.example.RideMate.service;


import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.RideRequestRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class ReminderService {

    private final RideRequestRepository rideRequestRepository;
    private final MatchRepository matchRepository;
    private final TelegramBotService telegramBotService;

    public ReminderService(RideRequestRepository rideRequestRepository,
                           MatchRepository matchRepository,
                           TelegramBotService telegramBotService) {
        this.rideRequestRepository = rideRequestRepository;
        this.matchRepository = matchRepository;
        this.telegramBotService = telegramBotService;
    }

    // Запускается каждые 5 минут
    @Scheduled(fixedRate = 300000) // каждые 5 минут
    @Transactional(readOnly = true)
    public void sendReminders() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime threshold = now.plusHours(1);

        List<RideRequest> upcomingRides = rideRequestRepository.findAll().stream()
                .filter(r -> r.getDepartureTime() != null)
                .filter(r -> r.getStatus() == RideStatus.MATCHED || r.getStatus() == RideStatus.ACTIVE)
                .filter(r -> r.getDepartureTime().isAfter(now) && r.getDepartureTime().isBefore(threshold))
                .toList();

        for (RideRequest ride : upcomingRides) {
            if (!Boolean.TRUE.equals(ride.getReminderSent())) {
                sendReminderToOwner(ride);
                if (ride.getAcceptedMatchId() != null) {
                    sendReminderToResponder(ride);
                }
                ride.setReminderSent(true);
                rideRequestRepository.save(ride);
            }
        }
    }

    private void sendReminderToOwner(RideRequest ride) {
        User owner = ride.getUser();
        if (owner.getChatId() != null) {
            String message = "🔔 Напоминание: ваша поездка " +
                    ride.getFromLocation().getY() + "," + ride.getFromLocation().getX() +
                    " → " + ride.getToLocation().getY() + "," + ride.getToLocation().getX() +
                    " начнётся через час (" + ride.getDepartureTime().toString() + ")";
            telegramBotService.sendMessage(owner.getChatId(), message);
        }
    }

    private void sendReminderToResponder(RideRequest ride) {
        Match match = matchRepository.findById(ride.getAcceptedMatchId()).orElse(null);
        if (match != null) {
            User responder = match.getResponder();
            if (responder.getChatId() != null) {
                String message = "🔔 Напоминание: ваша совместная поездка " +
                        ride.getFromLocation().getY() + "," + ride.getFromLocation().getX() +
                        " → " + ride.getToLocation().getY() + "," + ride.getToLocation().getX() +
                        " начнётся через час";
                telegramBotService.sendMessage(responder.getChatId(), message);
            }
        }
    }
}