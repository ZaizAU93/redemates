package com.example.RideMate.service;


import com.example.RideMate.dto.GeocodingResult;

import java.util.List;

public interface GeocodingService {

    List<GeocodingResult> search(String query);
}