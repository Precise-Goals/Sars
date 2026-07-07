using UnityEngine;
using System.Runtime.InteropServices;

// Simple serializable class to parse the JSON config from React
[System.Serializable]
public class PlayerConfig
{
    public string name;
    public string quality;
}

public class WebBridge : MonoBehaviour
{
    // Bind the Javascript method 'GameOver' provided via a .jslib plugin
    // This allows Unity to communicate events back to the React frontend
    [DllImport("__Internal")]
    private static extern void GameOver(int score);

    [Header("Game State")]
    public int currentScore = 0; // Mock score for the example

    /// <summary>
    /// Receives configuration payload directly from React.
    /// Triggered via: sendMessage("WebBridge", "SetPlayerConfig", json)
    /// </summary>
    public void SetPlayerConfig(string json)
    {
        PlayerConfig config = JsonUtility.FromJson<PlayerConfig>(json);
        if (config != null)
        {
            Debug.Log($"[WebBridge] Player Config Loaded - Name: {config.name}, Quality: {config.quality}");
            // Apply graphical fidelity or player data logic here...
        }
        else
        {
            Debug.LogError("[WebBridge] Failed to parse PlayerConfig JSON.");
        }
    }

    /// <summary>
    /// Receives spawn command from the React UI overlay.
    /// Triggered via: sendMessage("WebBridge", "SpawnEnemy")
    /// </summary>
    public void SpawnEnemy()
    {
        Debug.Log("[WebBridge] SpawnEnemy command received from React UI!");
        // Add actual enemy instantiation logic here...
    }

    /// <summary>
    /// Triggers the game over state, pushing the final score out to the browser.
    /// It ensures the extern is only invoked when built for WebGL to avoid Editor errors.
    /// </summary>
    public void TriggerGameOver()
    {
        Debug.Log($"[WebBridge] Dispatching GameOver to React with score: {currentScore}");

        #if UNITY_WEBGL && !UNITY_EDITOR
        GameOver(currentScore);
        #endif
    }
}
