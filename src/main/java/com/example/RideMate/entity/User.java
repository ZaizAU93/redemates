package com.example.RideMate.entity;

import jakarta.persistence.*;
import lombok.Data;

@Entity
@Table(name = "users")
@Data
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private Long telegramId;

    private String username;
    private String firstName;
    private String lastName;
    private String languageCode;
    private Boolean Premium;

    // Роль: PASSENGER или DRIVER
    @Enumerated(EnumType.STRING)
    private Role role;
    private Long chatId;

    private Double rating;        // средний рейтинг
    private Integer tripCount;    // количество завершённых поездок


    @Column(nullable = false)
    private Integer noShowCount = 0;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, columnDefinition = "VARCHAR(20) DEFAULT 'ACTIVE'")
    private UserStatus status = UserStatus.ACTIVE;

    private String phone;

    @Column(name = "phone_verified", nullable = false)
    private Boolean phoneVerified = false;

    @Column(length = 3)
    private String currency; // BYN, RUB, KZT, UZS, USD

}