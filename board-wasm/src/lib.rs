use wasm_bindgen::prelude::*;
use sha2::{Sha256, Digest};

#[wasm_bindgen]
pub fn generate_fingerprint_hash(raw_data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_data.as_bytes());
    // 衝突を防ぐため8バイト(16文字)を使用
    hex::encode(&hasher.finalize()[..8])
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
    let n = num.clamp(1, 10);
    let s = sides.clamp(2, 1000);
    
    let mut total: u32 = 0;
    let mut rolls: Vec<String> = Vec::new();

    let limit = (u32::MAX / s) * s;

    for i in 0..n {
        let mut round = 0u32;
        let mut roll_result = 1u32;
        while round < 100 {
            let mut hasher = Sha256::new();
            hasher.update(format!("{}:{}:{}", seed_str, i, round).as_bytes());
            let hash = hasher.finalize();

            let val = u32::from_be_bytes([hash[0], hash[1], hash[2], hash[3]]);
            if val < limit {
                roll_result = (val % s) + 1;
                break;
            }
            round += 1;
        }

        rolls.push(roll_result.to_string());
        total += roll_result;
    }

    return format!("🎲 出目: {} [合計: {}] ({}d{})", rolls.join(", "), total, n, s);
}

#[wasm_bindgen]
pub fn check_moderation_status(up: u32, down: u32, threshold: u32) -> bool {
    down >= threshold && down > up
}

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        let b = bytes.as_ref();
        let mut s = String::with_capacity(b.len() * 2);
        for &byte in b {
            s.push_str(&format!("{:02x}", byte));
        }
        s
    }
}