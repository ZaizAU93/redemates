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

// геттер и сеттер


}