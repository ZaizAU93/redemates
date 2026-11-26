package com.example.RideMate.controller;

import com.example.RideMate.dto.RoleUpdateRequest;
import com.example.RideMate.dto.UserRegistrationRequest;
import com.example.RideMate.dto.UserResponseDTO;
import com.example.RideMate.entity.User;
import com.example.RideMate.entity.Vehicle;
import com.example.RideMate.repository.UserRepository;
import com.example.RideMate.service.TelegramAuthService;
import com.example.RideMate.service.UserService;
import com.example.RideMate.service.VehicleService;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/users")
@CrossOrigin
@Data
public class UserController {

    private final UserRepository userRepository;          // ← ДОБАВЛЕНО
    private final VehicleService vehicleService;
    private final UserService userService;
    private final TelegramAuthService authService;

    public UserController(UserRepository userRepository,   // ← ДОБАВЛЕНО
                          VehicleService vehicleService,
                          UserService userService,
                          TelegramAuthService authService) {
        this.userRepository = userRepository;
        this.vehicleService = vehicleService;
        this.userService = userService;
        this.authService = authService;
    }

    @PostMapping("/register")
    public UserResponseDTO register(
            @RequestBody(required = false) UserRegistrationRequest request,
            @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        JsonNode tgUser = authService.getTelegramUser(initData);
        String firstName = tgUser.path("first_name").asText("");
        String lastName  = tgUser.path("last_name").asText("");
        String username  = tgUser.hasNonNull("username") ? tgUser.get("username").asText() : null;
        String language  = tgUser.hasNonNull("language_code") ? tgUser.get("language_code").asText() : null;
        User user = userService.registerOrUpdate(telegramId, username, firstName, lastName, language, null);
        return toDTO(user);
    }

    @PutMapping("/role")
    public UserResponseDTO updateRole(@RequestBody RoleUpdateRequest request,
                                      @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        User user = userService.updateRole(telegramId, request.role());
        return toDTO(user);
    }

    // 🔥 НОВОЕ: эндпоинт для получения текущего пользователя (без регистрации)
    @GetMapping("/me")
    public UserResponseDTO getCurrentUser(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return toDTO(user);
    }

    @PutMapping("/about")
    public Map<String, Object> saveAbout(@RequestBody Map<String, String> body,
                                         @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        String about = body.get("aboutMe");
        if (about != null && about.length() > 140) {
            return Map.of("ok", false, "message", "Максимум 140 символов");
        }

        user.setAboutMe(about);
        userRepository.save(user);
        return Map.of("ok", true);
    }

    private UserResponseDTO toDTO(User user) {
        String role = user.getRole() != null ? user.getRole().name() : null;
        Vehicle vehicle = null;
        if ("DRIVER".equals(role)) {
            vehicle = vehicleService.getVehicleForUser(user.getTelegramId());
        }
        return new UserResponseDTO(
                user.getTelegramId(),
                user.getUsername(),
                user.getFirstName(),
                user.getLastName(),
                role,
                user.getRating(),
                user.getTripCount(),
                vehicle != null ? vehicle.getBrand() : null,
                vehicle != null ? vehicle.getModel() : null,
                vehicle != null ? vehicle.getColor() : null,
                vehicle != null ? vehicle.getSeats() : null,
                user.getCurrency() != null ? user.getCurrency() : "BYN",
                user.getAboutMe()
        );
    }
}