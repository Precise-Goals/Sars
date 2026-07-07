using System.Collections.Generic;
using UnityEngine;
using System.Runtime.InteropServices;

[System.Serializable]
public class PlayerInput {
    public bool w;
    public bool a;
    public bool s;
    public bool d;
    public float rotY;
    public bool shoot;
}

[System.Serializable]
public class Vector3Data {
    public float x;
    public float y;
    public float z;
}

[System.Serializable]
public class PlayerState {
    public string id;
    public Vector3Data position;
    public float rotY;
    public int health;
    public int score;
}

public class SarsNetworkBridge : MonoBehaviour
{
    [DllImport("__Internal")]
    private static extern void SendInputToServer(string inputJson);

    [Header("Prefabs")]
    public GameObject enemyPrefab;

    [Header("Settings")]
    public float lerpSpeed = 15f;
    
    // Assign this to your unique local connection ID when you receive it so you don't spawn a dummy prefab for yourself.
    public string localPlayerId = ""; 

    private Dictionary<string, GameObject> enemyObjects = new Dictionary<string, GameObject>();
    private Dictionary<string, Vector3> targetPositions = new Dictionary<string, Vector3>();
    private Dictionary<string, Quaternion> targetRotations = new Dictionary<string, Quaternion>();

    void Update()
    {
        // 1. Capture inputs
        PlayerInput input = new PlayerInput();
        input.w = Input.GetKey(KeyCode.W);
        input.a = Input.GetKey(KeyCode.A);
        input.s = Input.GetKey(KeyCode.S);
        input.d = Input.GetKey(KeyCode.D);
        
        // Convert Unity's degrees to radians for the backend trigonometry Math.sin/cos expectations
        input.rotY = transform.eulerAngles.y * Mathf.Deg2Rad;
        
        // Capture left mouse button clicks
        input.shoot = Input.GetMouseButton(0); 

        // 2. Format as JSON string
        string json = JsonUtility.ToJson(input);

        // 3. Send to JS frontend bridge
        #if UNITY_WEBGL && !UNITY_EDITOR
        SendInputToServer(json);
        #endif

        // 4. Smoothly interpolate all enemy positions to prevent jitter
        foreach (var kvp in enemyObjects)
        {
            string id = kvp.Key;
            GameObject enemy = kvp.Value;

            if (targetPositions.ContainsKey(id))
            {
                enemy.transform.position = Vector3.Lerp(enemy.transform.position, targetPositions[id], Time.deltaTime * lerpSpeed);
            }
            if (targetRotations.ContainsKey(id))
            {
                enemy.transform.rotation = Quaternion.Slerp(enemy.transform.rotation, targetRotations[id], Time.deltaTime * lerpSpeed);
            }
        }
    }

    /// <summary>
    /// Called from the JS frontend using UnityInstance.SendMessage("GameObjectName", "SyncServerState", jsonString)
    /// </summary>
    public void SyncServerState(string jsonState)
    {
        // Unity's JsonUtility doesn't natively support raw arrays directly, we use a wrapper trick (defined below)
        PlayerState[] players = JsonHelper.FromJson<PlayerState>(jsonState);

        if (players == null) return;

        HashSet<string> activeServerIds = new HashSet<string>();

        foreach (PlayerState p in players)
        {
            // Skip spawning our own local player
            if (!string.IsNullOrEmpty(localPlayerId) && p.id == localPlayerId) continue;

            activeServerIds.Add(p.id);

            // Instantiate a new enemy prefab if we haven't tracked this ID yet
            if (!enemyObjects.ContainsKey(p.id))
            {
                if (enemyPrefab != null)
                {
                    enemyObjects[p.id] = Instantiate(enemyPrefab);
                }
                else
                {
                    enemyObjects[p.id] = new GameObject($"Enemy_{p.id}");
                }
            }

            // Update authoritative target transforms
            Vector3 newTargetPos = new Vector3(p.position.x, p.position.y, p.position.z);
            targetPositions[p.id] = newTargetPos;
            
            // Convert radians back to degrees for Unity
            targetRotations[p.id] = Quaternion.Euler(0, p.rotY * Mathf.Rad2Deg, 0);
        }

        // Garbage collect players that disconnected
        List<string> disconnectedIds = new List<string>();
        foreach (string id in enemyObjects.Keys)
        {
            if (!activeServerIds.Contains(id))
            {
                disconnectedIds.Add(id);
            }
        }

        foreach (string id in disconnectedIds)
        {
            if (enemyObjects[id] != null) Destroy(enemyObjects[id]);
            enemyObjects.Remove(id);
            targetPositions.Remove(id);
            targetRotations.Remove(id);
        }
    }
}

// Small utility to trick Unity's JsonUtility into parsing raw JSON arrays
public static class JsonHelper
{
    public static T[] FromJson<T>(string json)
    {
        string newJson = "{ \"array\": " + json + "}";
        Wrapper<T> wrapper = JsonUtility.FromJson<Wrapper<T>>(newJson);
        return wrapper.array;
    }

    [System.Serializable]
    private class Wrapper<T>
    {
        public T[] array;
    }
}
