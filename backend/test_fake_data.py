import requests, random, time

while True:
    data = {
        "device_id"   : "ESP32_AiPECO_01",
        "raw_adc"     : random.randint(1800, 2400),
        "pin_voltage" : round(random.uniform(1.4, 2.0), 3),
        "temperature" : round(random.uniform(24, 35), 1),
        "humidity"    : round(random.uniform(40, 75), 1),
        "relay_state" : False
    }
    r = requests.post("http://localhost:5000/api/readings", json=data)
    print(f"Sent → HTTP {r.status_code}")
    time.sleep(3)
     