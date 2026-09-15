package com.example.RideMate;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class RideMateApplication {

	public static void main(String[] args) {
		SpringApplication.run(RideMateApplication.class, args);
	}

}
