package com.example.RideMate.controller;


import com.example.RideMate.dto.GeocodingResult;
import com.example.RideMate.service.GeocodingService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/geocoding")
@CrossOrigin
public class GeocodingController {

    private final GeocodingService geocodingService;

    public GeocodingController(GeocodingService geocodingService) {
        this.geocodingService = geocodingService;
    }

    @GetMapping
    public List<GeocodingResult> search(@RequestParam String q) {
        return geocodingService.search(q);
    }
}