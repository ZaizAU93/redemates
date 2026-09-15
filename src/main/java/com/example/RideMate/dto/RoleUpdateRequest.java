package com.example.RideMate.dto;

import com.example.RideMate.entity.Role;

public record RoleUpdateRequest(Long telegramId, Role role) {}