package com.example.RideMate.controller;



import com.example.RideMate.dto.RoleUpdateRequest;
import com.example.RideMate.dto.UserRegistrationRequest;
import com.example.RideMate.dto.UserResponseDTO;
import com.example.RideMate.entity.User;
import com.example.RideMate.entity.Vehicle;
import com.example.RideMate.service.TelegramAuthService;
import com.example.RideMate.service.UserService;
import com.example.RideMate.service.VehicleService;
import lombok.Data;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/users")
@CrossOrigin
@Data
public class UserController {

    private final VehicleService vehicleService;
    private final UserService userService;
    private final TelegramAuthService authService;


    @PostMapping("/register")
    public UserResponseDTO register(@RequestBody UserRegistrationRequest request,
                                    @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        System.out.println("Получен initData: " + initData);
        Long telegramId = authService.authenticate(initData);
        // Игнорируем telegramId из тела, используем из initData
        User user = userService.registerOrUpdate(
                telegramId,
                request.username(),
                request.firstName(),
                request.lastName(),
                request.languageCode(),
                request.isPremium()
        );
        return toDTO(user);
    }

    @PutMapping("/role")
    public UserResponseDTO updateRole(@RequestBody RoleUpdateRequest request,
                                      @RequestHeader(value = "X-Telegram-Init-Data", required = false) String initData) {
        Long telegramId = authService.authenticate(initData);
        User user = userService.updateRole(telegramId, request.role());
        return toDTO(user);
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
                vehicle != null ? vehicle.getSeats() : null
        );
    }
}