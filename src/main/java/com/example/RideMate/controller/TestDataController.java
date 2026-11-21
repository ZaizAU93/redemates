package com.example.RideMate.controller;

import com.example.RideMate.entity.RideRequest;
import com.example.RideMate.entity.RideStatus;
import com.example.RideMate.entity.Role;
import com.example.RideMate.entity.User;
import com.example.RideMate.entity.Vehicle;
import com.example.RideMate.repository.RideRequestRepository;
import com.example.RideMate.repository.VehicleRepository;
import com.example.RideMate.service.UserService;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * ТОЛЬКО ДЛЯ РАЗРАБОТКИ. Удалить перед выкладыванием в прод:
 * эндпоинты позволяют выпустить себе валидную подпись любого Telegram-пользователя.
 */
@RestController
public class TestDataController {

    @Value("${telegram.bot-token}")
    private String botToken;

    private final UserService userService;
    private final RideRequestRepository rideRequestRepository;
    private final VehicleRepository vehicleRepository;
    private final GeometryFactory geometryFactory;

    public TestDataController(UserService userService,
                              RideRequestRepository rideRequestRepository,
                              VehicleRepository vehicleRepository,
                              GeometryFactory geometryFactory) {
        this.userService = userService;
        this.rideRequestRepository = rideRequestRepository;
        this.vehicleRepository = vehicleRepository;
        this.geometryFactory = geometryFactory;
    }

    public record InitDataResponse(String initData, Long userId, String firstName) {}

    /**
     * Генерирует валидно подписанный Telegram initData — как это делал бы Telegram.
     * Фронт использует его в браузере, где настоящего initData нет.
     */
    @GetMapping("/debug/init-data")
    public InitDataResponse init(@RequestParam Long userId,
                                 @RequestParam String firstName,
                                 @RequestParam(required = false) String username) {
        String safeName = firstName.replace("\"", "");
        String safeUsername = (username == null ? "test" + userId : username).replace("\"", "");
        String userJson = String.format(
                "{\"id\":%d,\"first_name\":\"%s\",\"username\":\"%s\",\"language_code\":\"ru\"}",
                userId, safeName, safeUsername);

        long authDate = Instant.now().getEpochSecond();

        // data_check_string: параметры (кроме hash), отсортированные по ключу: auth_date, user
        String dataCheckString = "auth_date=" + authDate + "\nuser=" + userJson;

        byte[] secret = hmac("WebAppData".getBytes(StandardCharsets.UTF_8),
                botToken.trim().getBytes(StandardCharsets.UTF_8));
        String hash = bytesToHex(hmac(secret, dataCheckString.getBytes(StandardCharsets.UTF_8)));

        String initData = "auth_date=" + authDate
                + "&user=" + URLEncoder.encode(userJson, StandardCharsets.UTF_8)
                + "&hash=" + hash;

        return new InitDataResponse(initData, userId, safeName);
    }

    /**
     * Создаёт двух тестовых пользователей (если их ещё нет) и по одной активной заявке.
     * Повторный вызов безопасен: существующие не трогает.
     */
    @GetMapping("/debug/seed")
    public Map<String, Object> seed() {
        Map<String, Object> result = new LinkedHashMap<>();

        User vasya = ensureUser(111111L, "vasya_test", "Вася", "Тестовый", Role.DRIVER);
        User maria = ensureUser(222222L, "maria_test", "Мария", "Тестовая", Role.PASSENGER);
        ensureVehicle(vasya, "Toyota", "Corolla", "Белый", 4);

        LocalDateTime tomorrowMorning = LocalDateTime.now().plusDays(1).withHour(9).withMinute(0).withSecond(0);
        LocalDateTime tomorrowEvening = LocalDateTime.now().plusDays(1).withHour(19).withMinute(30).withSecond(0);

        boolean driverRide = createIfAbsent(vasya, Role.DRIVER,
                53.9006, 27.5590,   // Минск
                54.0745, 26.9550,   // Поставы
                tomorrowMorning, 1, 3, "Можно кота", new BigDecimal("15"));
        boolean passengerRide = createIfAbsent(maria, Role.PASSENGER,
                53.9006, 27.5590,   // Минск
                53.6688, 23.8299,   // Гродно
                tomorrowEvening, 2, null, "Нужен багажник для лыж", null);

        result.put("vasya", vasya.getTelegramId());
        result.put("maria", maria.getTelegramId());
        result.put("createdDriverRide", driverRide);
        result.put("createdPassengerRide", passengerRide);
        return result;
    }

    // ---------- Вспомогательное ----------

    private User ensureUser(Long telegramId, String username, String firstName, String lastName, Role role) {
        User user = userService.registerOrUpdate(telegramId, username, firstName, lastName, "ru", false);
        if (user.getRole() == null) {
            user = userService.updateRole(telegramId, role);
        }
        return user;
    }

    private void ensureVehicle(User owner, String brand, String model, String color, int seats) {
        if (vehicleRepository.findFirstByOwnerIdOrderByCreatedAtDesc(owner.getId()) != null) return;
        Vehicle v = new Vehicle();
        v.setOwner(owner);
        v.setBrand(brand);
        v.setModel(model);
        v.setColor(color);
        v.setSeats(seats);
        v.setVerified(true);
        vehicleRepository.save(v);
    }

    private boolean createIfAbsent(User user, Role role,
                                   double fromLat, double fromLon,
                                   double toLat, double toLon,
                                   LocalDateTime departureTime,
                                   Integer passengerCount, Integer availableSeats,
                                   String note, BigDecimal price) {
        if (rideRequestRepository.findFirstByUserIdAndStatus(user.getId(), RideStatus.ACTIVE).isPresent()) {
            return false;
        }
        RideRequest r = new RideRequest();
        r.setUser(user);
        r.setRole(role);
        r.setFromLocation(point(fromLat, fromLon));
        r.setToLocation(point(toLat, toLon));
        r.setDepartureTime(departureTime);
        r.setPassengerCount(passengerCount);
        r.setAvailableSeats(availableSeats);
        r.setNote(note);
        r.setStatus(RideStatus.ACTIVE);
        r.setReminderSent(false);
        r.setTimeFlexibilityMinutes(60);
        r.setPricePerSeat(price);
        rideRequestRepository.save(r);
        return true;
    }

    private Point point(double lat, double lon) {
        return geometryFactory.createPoint(new Coordinate(lon, lat));
    }

    private byte[] hmac(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (Exception e) {
            throw new RuntimeException("HMAC error", e);
        }
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b & 0xff));
        return sb.toString();
    }
}
