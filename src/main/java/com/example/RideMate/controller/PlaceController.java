package com.example.RideMate.controller;


import com.example.RideMate.dto.LocationRequest;
import com.example.RideMate.entity.Place;
import com.example.RideMate.service.PlaceService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/places")
@CrossOrigin
public class PlaceController {

    private final PlaceService placeService;

    public PlaceController(PlaceService placeService) {
        this.placeService = placeService;
    }

    @PostMapping
    public Place savePlace(@RequestBody LocationRequest request) {
        return placeService.savePlace(request);
    }

    @GetMapping("/nearest")
    public List<Place> findNearest(
            @RequestParam double lat,
            @RequestParam double lon
    ) {
        return placeService.findNearest(lat, lon);
    }
}