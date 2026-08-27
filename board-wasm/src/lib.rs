use wasm_bindgen::prelude::*;
use sha2::{Sha256, Digest};

#[wasm_bindgen]
pub fn generate_fingerprint_hash(raw_data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_data.as_bytes());
    hex::encode(&hasher.finalize()[..6])
}

#[wasm_bindgen]
pub fn solve_pow(challenge: &str, difficulty: usize) -> String {
    let prefix = "0".repeat(difficulty);
    let mut nonce: u64 = 0;
    loop {
        let input = format!("{}{}", challenge, nonce);
        let mut hasher = Sha256::new();
        hasher.update(input.as_bytes());
        let hash = hex::encode(hasher.finalize());
        if hash.starts_with(&prefix) {
            return format!(r#"{{"nonce":{},"hash":"{}"}}"#, nonce, hash);
        }
        nonce += 1;
    }
}

/// ダイス処理 (diceNdM)
#[wasm_bindgen]
pub fn roll_dice(num: u32, sides: u32, seed_str: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seed_str.as_bytes());
    let hash = hasher.finalize();
    
    let mut total: u32 = 0;
    let mut rolls = Vec::new();
    let n = num.clamp(1, 10);
    let s = sides.clamp(2, 1000);

    for i in 0..n {
        let byte = hash[i as usize % hash.len()] as u32;
        let roll = (byte % s) + 1;
        rolls.push(roll.to_string());
        total += roll;
    }

    return format!("🎲 出目: {} [合計: {}] ({}d{})", rolls.join(", "), total, n, s);
}

#[wasm_bindgen]
pub fn check_moderation_status(up: u32, down: u32, threshold: u32) -> bool {
    down >= threshold && down > up
}

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }
}